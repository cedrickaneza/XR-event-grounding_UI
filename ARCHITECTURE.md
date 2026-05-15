# XR Event Grounding · Architecture

> A graph-grounded conversational agent for XR-captured assembly procedures.
> Built on top of the IndustReal pipeline's Neo4j export.

---

## What this is

A three-pane operator console — **Steps · Video · Agent** — where the
**Agent** can only answer questions that are grounded in the assembly graph
the IndustReal pipeline produces. Every answer cites the specific nodes
(`AssemblyGoal`, `AssemblyPhase`, `AssemblyEvent`, `Component`) it walked,
and the operator can pop open the live subgraph the model was given.

If the answer isn't in the subgraph, the agent says so.

---

## Layers

```
                                     ┌─────────────────────────┐
  Operator's screen   ───────────────┤  Frontend (React+Vite)  │
                                     │  • Steps  • Video       │
                                     │  • Chat   • Graph viz   │
                                     │  • Provider config      │
                                     └──────────┬──────────────┘
                                                │ REST (/query, /tts)
                                                ▼
                                     ┌─────────────────────────┐
                                     │  Backend (FastAPI)      │
                                     │                         │
                                     │  schemas.py             │
                                     │  main.py                │
                                     │                         │
                                     │  ┌──────────────────┐   │
                                     │  │ retriever.py     │   │  graph-only RAG
                                     │  │ prompts.py       │   │  (BFS subgraph
                                     │  └────────┬─────────┘   │   + serialize)
                                     │           │             │
                          ┌──────────┴───────────┼─────────────┴───────────┐
                          ▼                      ▼                         ▼
                ┌──────────────────┐  ┌──────────────────┐    ┌──────────────────┐
                │ graph_store.py   │  │ providers.py     │    │ config.py        │
                │                  │  │                  │    │                  │
                │ JSONGraphStore   │  │ LLMProvider:     │    │ .env loading     │
                │ Neo4jGraphStore  │  │  OpenAI          │    │ feature flags    │
                │  (same interface)│  │  Anthropic       │    │                  │
                │                  │  │  Ollama (local)  │    │                  │
                │                  │  │  LMStudio (local)│    │                  │
                │                  │  │ TTSProvider:     │    │                  │
                │                  │  │  ElevenLabs      │    │                  │
                │                  │  │  OpenAI TTS      │    │                  │
                └────────┬─────────┘  └──────────────────┘    └──────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
   results/raw_cad_pilot/*    Neo4j AuraDB
   (JSON the pipeline         (via the existing
    already produces)         IndustReal import
                              scripts)
```

---

## The two interfaces that matter

The architecture is mostly two abstractions. Pin those down and everything
else slots in.

### 1. `GraphStore`

```python
class GraphStore:
    def list_clips(self) -> list[str]: ...
    def build(self, clip_id: str) -> Graph: ...
```

Two implementations ship:

- **`JSONGraphStore`** — reads the IndustReal pipeline's JSON outputs
  (`results/raw_cad_pilot/*/assembly_graph.json` and the
  `*_results.json` files). No database required. Use this for demos,
  notebooks, evaluation runs, or when Neo4j is unavailable.

- **`Neo4jGraphStore`** — runs Cypher against your real Neo4j AuraDB
  instance. Use this in production once your operator console is
  pulling captures from the actual ingestion pipeline.

Both produce the same in-memory `Graph` (nodes, edges, adjacency index).
The retriever doesn't know or care which one built it.

Adding **DuckDB**, **Memgraph**, **Kuzu**, **TigerGraph**, or a custom
backend is one class.

### 2. `LLMProvider` (and `TTSProvider`)

```python
class LLMProvider:
    name: str
    kind: str          # "cloud" | "local" | "builtin"
    endpoint: str
    needs_key: bool

    async def complete(self, *, system_prompt: str, user_message: str) -> str: ...
```

Adapters ship for OpenAI, Anthropic, Gemini, Ollama, LM Studio. Adding a
new model is one class registered in `LLM_REGISTRY`. Same shape for
voice (`TTSProvider`).

The frontend picks a provider by id (`openai-gpt4o`, `ollama-local`,
…). The query endpoint dispatches; the rest of the app stays the same.

---

## The retrieval pipeline (the part that actually matters)

This is what makes the agent grounded rather than a generic chatbot:

```
USER asks a question
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ 1. Seed                                               │
│    • the active Event the operator is on              │
│    • that Event's Phase + ACTS_ON Component           │
│    • the clip's Goal                                  │
└───────────────────┬───────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────┐
│ 2. BFS expand to depth N                              │
│    Follow any edge: HAS_PHASE, HAS_STEP, ACTS_ON,     │
│    NEXT, NEXT_PHASE, TARGETS_COMPONENT.               │
└───────────────────┬───────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────┐
│ 3. Score each candidate                               │
│    • keyword overlap with the question                │
│    • +seed boost                                      │
│    • -distance penalty                                │
│    Keep top-k (default 14). Always retain seeds.      │
└───────────────────┬───────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────┐
│ 4. Serialize for the LLM                              │
│    Compact NODES: / EDGES: text with stable short ids │
│    [e1], [p1], [c2] … so the answer can cite them.    │
└───────────────────┬───────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────┐
│ 5. Prompt the LLM                                     │
│    System prompt forces graph-only answers + cited    │
│    node ids. Refuses politely if the answer isn't in  │
│    the subgraph.                                      │
└───────────────────┬───────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────┐
│ 6. Parse citations + return                           │
│    Pull [eN] / [pN] markers out of the answer.        │
│    Send back: answer text + cited nodes + the WHOLE   │
│    subgraph the model saw (so the UI can render it).  │
└───────────────────┬───────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────────┐
│ 7. Speak the answer                                   │
│    TTSProvider.speak(answer_without_citations).       │
└───────────────────────────────────────────────────────┘
```

The visualization in the right rail / overlay is just step 4's subgraph
rendered as SVG. **The model and the operator are looking at the same
thing.** That's the whole pitch.

---

## REST contract

```
GET  /clips           → list of available clips
POST /query           → graph-grounded RAG
POST /tts             → server-side TTS (returns audio/mpeg)
GET  /providers       → which LLMs / voices are configured
```

`POST /query` body:

```json
{
  "clip_id": "03_assy_0_1",
  "active_event_id": "event::03_assy_0_1::1",
  "question": "Why are the first three steps on the same frame?",
  "depth": 2,
  "top_k": 14,
  "llm": "openai-gpt4o"
}
```

Response:

```json
{
  "answer": "Steps [e1], [e2], [e3] all fire at frame 709 because the rear chassis and both pins lock together…",
  "citations": [
    {"short_id": "e1", "node": { ... }},
    {"short_id": "e2", "node": { ... }},
    ...
  ],
  "subgraph": { "nodes": [...], "edges": [...], "seeds": [...] },
  "confidence": 0.88,
  "llm": "openai-gpt4o"
}
```

The **frontend renders `citations` as chips** under the answer and
**`subgraph` as the live graph visualization** in the overlay.

---

## How a new feature lands

| Want to… | Touch |
|---|---|
| Use Gemini instead of GPT-4o | Add one `LLMProvider` adapter to `providers.py`. |
| Use a custom local TTS | Add one `TTSProvider` adapter. |
| Switch to Memgraph | Add one `GraphStore` adapter. |
| Add a new node kind to the graph | Update the IndustReal exporter — schema flows downstream automatically. |
| Tighten retrieval | Tune `depth` and `top_k` in `retriever.py`, or replace BFS with a Cypher query that goes through Neo4j directly. |
| Add eval | Drop known-answer pairs in a YAML; run `pytest` against `/query`. |
| Ship to multiple environments | Move endpoint URLs and keys into env vars (already done in `config.py`). |

---

## Build phases · suggested rollout

### Week 1 · Backend skeleton

- FastAPI server running locally with `JSONGraphStore` against your
  existing `IndustReal_Pipeline/results/` directory.
- One LLM adapter (OpenAI). One voice adapter (ElevenLabs).
- `POST /query` returns real answers cited against real nodes.
- Eval harness: 20-30 question/expected-citation pairs per clip.

### Week 2 · Frontend hi-fi

- Promote the React prototype in `platform/` to a real Vite app.
- Point it at `http://localhost:8000`.
- Real video player loaded against the IndustReal clip files (set up
  symbolic links from your `Quest_Capture/` videos into a static-served
  directory).
- Polish: keyboard navigation, transcript caption sync, overlay UX.

### Week 3 · Provider depth + voice

- Add Anthropic, Gemini, Ollama, LM Studio adapters.
- Add OpenAI TTS, Piper (local) for voice.
- Full AI Configuration screen with key management, "Test connection"
  per provider, voice preview.

### Week 4 · Neo4j adapter + observability

- Flip `GRAPH_BACKEND=neo4j` and run the same `/query` against your real
  Neo4j database — no frontend changes required.
- Log retrieval metrics: top_k sufficiency, citation coverage,
  ungrounded-answer rate.
- Optional: stream the retrieval (server-sent events) so the graph viz
  animates BFS expansion in real time.

---

## What's intentionally not here yet

- **Authentication / multi-tenant**. Single operator for now.
- **Conversation memory across turns**. Each `/query` is stateless.
  Adding turn history is one field in the request.
- **Tool use**. The agent only retrieves; it doesn't act. Adding a tool
  like "mark step complete" is a new endpoint + a tool-call adapter in
  `LLMProvider.complete`.
- **Video grounding from the live HoloLens feed**. The current platform
  shows a pre-recorded reference video tied to graph timestamps. Wiring
  the live Quest_Capture stream is a frontend change only.

---

## File map

```
platform/                          frontend (this repo)
  Platform.html                    entry
  data/graph-data.js              real IndustReal data, pre-baked
  src/
    lattice-tokens.css            design system tokens
    styles.css                    product styles
    graph-store.js                in-memory adapter for the demo
    retriever.js                  same algorithm as backend/retriever.py
    prompts.js                    same template as backend/prompts.py
    providers.js                  browser-side adapters
    components.jsx                Topbar, Steps, Video, Chat, Drawer
    graph-viz.jsx                 animated SVG subgraph
    app.jsx                       wiring + state

backend/                           Python (deploy this)
  main.py                         FastAPI app
  schemas.py                      pydantic models
  graph_store.py                  JSON + Neo4j adapters
  retriever.py                    BFS + serialize
  prompts.py                      system prompt
  providers.py                    LLM + TTS adapters
  config.py                       .env loading
  requirements.txt
  .env.example
  README.md

ARCHITECTURE.md                    this document
```
