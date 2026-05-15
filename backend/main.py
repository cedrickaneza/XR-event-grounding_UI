"""
XR Event Grounding — FastAPI server.

Exposes the same retrieval contract the browser prototype uses, server-side.
Three endpoints carry the whole flow:

    GET  /clips                         — list available clips
    POST /query                         — graph-grounded RAG (answer + subgraph)
    POST /tts                           — server-side TTS
    GET  /providers                     — what's available and what's configured

Wire your frontend to point at this and you have a deployable product.
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from config import SETTINGS
from graph_store import GraphStore, JSONGraphStore, Neo4jGraphStore
from prompts import build_system_prompt
from providers import LLM_REGISTRY, TTS_REGISTRY
from retriever import parse_citations, retrieve, serialize_for_llm
from schemas import (
    Citation,
    ClipSummary,
    ProvidersResponse,
    QueryRequest,
    QueryResponse,
    TTSRequest,
)

# ---------------------------------------------------------------------------
# Boot
# ---------------------------------------------------------------------------


def _make_store() -> GraphStore:
    if SETTINGS.graph_backend == "neo4j":
        return Neo4jGraphStore(SETTINGS.neo4j_uri, SETTINGS.neo4j_user, SETTINGS.neo4j_password)
    return JSONGraphStore(SETTINGS.industreal_results_root)


app = FastAPI(title="XR Event Grounding", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    # In production, narrow this to the frontend's actual origin.
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STORE: GraphStore = _make_store()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/clips", response_model=list[ClipSummary])
def list_clips() -> list[ClipSummary]:
    out: list[ClipSummary] = []
    for clip_id in STORE.list_clips():
        try:
            g = STORE.build(clip_id)
        except Exception:
            continue
        clip_node = next(iter(g.by_kind("Clip")), None)
        n_events = len(g.by_kind("Event"))
        if clip_node is None:
            out.append(ClipSummary(id=clip_id, n_frames=0, duration_s=0, n_events=n_events))
        else:
            out.append(ClipSummary(
                id=clip_id,
                n_frames=clip_node.props.get("n_frames") or 0,
                duration_s=clip_node.props.get("duration_s") or 0,
                n_events=n_events,
            ))
    return out


@app.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest) -> QueryResponse:
    """Retrieve a subgraph, prompt the LLM, return the answer + citations + subgraph."""
    try:
        graph = STORE.build(req.clip_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown clip: {req.clip_id}")

    retrieved = retrieve(graph, req.question, req.active_event_id, depth=req.depth, top_k=req.top_k)
    subgraph_text, ref_map = serialize_for_llm(retrieved.subgraph)

    # Build the active-step description line so the model knows where the
    # operator is in the procedure.
    active_line = "(no active step)"
    if req.active_event_id:
        active = graph.nodes.get(req.active_event_id)
        if active:
            short = next((s for s, n in ref_map.items() if n.id == active.id), "?")
            active_line = (
                f"[{short}] step \"{active.label}\" at frame {active.props.get('frame')} "
                f"({active.props.get('time_s')}s) acting on \"{active.props.get('component_name')}\""
            )

    system_prompt = build_system_prompt(
        clip_id=req.clip_id,
        active_step_line=active_line,
        subgraph_text=subgraph_text,
        question=req.question,
    )

    provider = LLM_REGISTRY.get(req.llm)
    if not provider:
        raise HTTPException(status_code=400, detail=f"unknown llm: {req.llm}")
    answer = await provider.complete(system_prompt=system_prompt, user_message=req.question)

    cited_short = parse_citations(answer)
    citations = [Citation(short_id=s, node=ref_map[s]) for s in cited_short if s in ref_map]
    if not citations:
        # No inline citations — surface the seeds so the UI can still draw the
        # retrieval trail (this is what we showed the model regardless).
        citations = [
            Citation(short_id=s, node=ref_map[s])
            for s in list(ref_map)[:8]
            if ref_map[s].id in retrieved.seeds
        ]

    confidence = min(0.95, 0.78 + 0.02 * len(citations))

    return QueryResponse(
        answer=answer, citations=citations, subgraph=retrieved.subgraph,
        confidence=confidence, llm=req.llm,
    )


@app.post("/tts")
async def tts(req: TTSRequest) -> Response:
    provider = TTS_REGISTRY.get(req.voice)
    if not provider:
        raise HTTPException(status_code=400, detail=f"unknown voice: {req.voice}")
    audio = await provider.speak(req.text)
    if not audio:
        raise HTTPException(status_code=503, detail="voice provider not configured")
    return Response(content=audio, media_type="audio/mpeg")


@app.get("/providers", response_model=ProvidersResponse)
def providers() -> ProvidersResponse:
    return ProvidersResponse(
        llm=[p.describe() for p in LLM_REGISTRY.values()],
        tts=[p.describe() for p in TTS_REGISTRY.values()],
    )


@app.get("/")
def root() -> dict:
    return {
        "name": "XR Event Grounding",
        "version": "0.1.0",
        "graph_backend": SETTINGS.graph_backend,
        "endpoints": ["/clips", "/query", "/tts", "/providers"],
    }


# ---------------------------------------------------------------------------
# Local entrypoint: `python main.py`
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=SETTINGS.host, port=SETTINGS.port, reload=True)
