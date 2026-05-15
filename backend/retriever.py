"""
Graph-only RAG retrieval.

Mirrors `platform/src/retriever.js` 1:1 so the same inputs produce the same
subgraph regardless of which side runs the retrieval. The frontend and
backend must agree on what the LLM sees — otherwise debugging is hell.
"""
from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass

from graph_store import Graph
from schemas import GraphNode, Subgraph

_STOPWORDS = {
    "the", "a", "an", "is", "of", "to", "do", "i", "does", "how", "what", "why",
    "where", "which", "when", "at", "on", "in", "for", "and", "or", "with",
    "without", "this", "that", "my", "me", "you", "be", "are", "was", "were",
    "it", "its", "but", "by", "from", "as", "can", "could", "should", "would",
    "need", "want", "use", "using", "step", "steps", "next", "previous",
}


def _tokens(s: str) -> list[str]:
    return [w for w in re.sub(r"[^a-z0-9 ]+", " ", s.lower()).split() if w and w not in _STOPWORDS]


def _node_score(node: GraphNode, q_tokens: list[str]) -> float:
    if not q_tokens:
        return 0.0
    haystack = (node.label + " " + " ".join(str(v) for v in node.props.values())).lower()
    s = sum(1 for t in q_tokens if t in haystack)
    label_words = set(re.split(r"[\s_]+", node.label.lower()))
    s += 0.5 * sum(1 for t in q_tokens if t in label_words)
    return s


def _bfs(graph: Graph, seed_ids: list[str], depth: int) -> dict[str, int]:
    dist: dict[str, int] = {sid: 0 for sid in seed_ids}
    q: deque[str] = deque(seed_ids)
    while q:
        nid = q.popleft()
        d = dist[nid]
        if d >= depth:
            continue
        for _edge, other in graph.neighbors(nid):
            if other not in dist:
                dist[other] = d + 1
                q.append(other)
    return dist


@dataclass
class Retrieved:
    subgraph: Subgraph
    seeds: list[str]


def retrieve(graph: Graph, question: str, active_event_id: str | None,
             depth: int = 2, top_k: int = 14) -> Retrieved:
    seeds: set[str] = set()
    if active_event_id and active_event_id in graph.nodes:
        seeds.add(active_event_id)
        for _e, other in graph.neighbors(active_event_id):
            n = graph.nodes.get(other)
            if n and n.kind in ("Phase", "Component"):
                seeds.add(other)
    for g in graph.by_kind("Goal"):
        seeds.add(g.id)

    if not seeds:
        # Defensive fallback — every clip has a Clip node.
        seeds = {n.id for n in graph.by_kind("Clip")}

    dist = _bfs(graph, list(seeds), depth)
    q_tokens = _tokens(question)

    scored: list[tuple[float, str]] = []
    for nid, d in dist.items():
        node = graph.nodes[nid]
        score = _node_score(node, q_tokens) * 1.5 + (1.2 if nid in seeds else 0) + max(0, 1.5 - d)
        scored.append((score, nid))
    scored.sort(reverse=True)

    keep = {nid for _s, nid in scored[:top_k]}
    keep.update(seeds)

    nodes = [graph.nodes[nid] for nid in keep]
    edges = [e for e in graph.edges if e.src in keep and e.dst in keep]

    return Retrieved(
        subgraph=Subgraph(
            nodes=nodes, edges=edges, seeds=sorted(seeds),
            active_event_id=active_event_id, question=question,
        ),
        seeds=sorted(seeds),
    )


def serialize_for_llm(subgraph: Subgraph) -> tuple[str, dict[str, GraphNode]]:
    """Produce a compact text block + a map from short id ("e2") to the node it
    references. Short ids are what the LLM is told to cite in its answer."""
    counts: dict[str, int] = {}
    id_map: dict[str, str] = {}        # full node id -> short id ("e2")
    ref_map: dict[str, GraphNode] = {}  # short id -> node

    def short_for(node: GraphNode) -> str:
        prefix = {"Goal": "g", "Phase": "p", "Event": "e", "Component": "c", "Clip": "k"}.get(node.kind, "n")
        counts[prefix] = counts.get(prefix, 0) + 1
        return f"{prefix}{counts[prefix]}"

    for n in subgraph.nodes:
        sid = short_for(n)
        id_map[n.id] = sid
        ref_map[sid] = n

    lines = ["NODES:"]
    for n in subgraph.nodes:
        sid = id_map[n.id]
        p = n.props
        if n.kind == "Goal":
            summary = f"target_state={p.get('target_state_index')} ({p.get('target_state_name')})"
        elif n.kind == "Phase":
            summary = f"order={p.get('order')}, key={p.get('phase_key')}"
        elif n.kind == "Event":
            summary = f"frame={p.get('frame')}, time={p.get('time_s')}s, conf={p.get('conf')}, acts_on={p.get('component_name')}"
        elif n.kind == "Component":
            summary = f"normalized={p.get('normalized_name')}"
        elif n.kind == "Clip":
            summary = f"n_frames={p.get('n_frames')}, duration={p.get('duration_s')}s"
        else:
            summary = ""
        lines.append(f"  [{sid}] ({n.kind}) \"{n.label}\" — {summary}")

    lines.append("\nEDGES:")
    for e in subgraph.edges:
        a = id_map.get(e.src); b = id_map.get(e.dst)
        if a and b:
            lines.append(f"  [{a}] -[:{e.type}]-> [{b}]")

    return "\n".join(lines), ref_map


def parse_citations(answer: str) -> list[str]:
    """Return the set of short ids the model cited, in first-occurrence order."""
    seen: set[str] = set()
    out: list[str] = []
    for m in re.finditer(r"\[([a-z]\d+)\]", answer):
        sid = m.group(1)
        if sid not in seen:
            seen.add(sid)
            out.append(sid)
    return out
