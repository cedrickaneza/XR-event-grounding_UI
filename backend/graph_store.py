"""
Graph store layer.

Two implementations of the same interface:

    JSONGraphStore  — walks the JSON files the IndustReal pipeline already
                      produces (assembly_graph.json + *_results.json +
                      the Neo4j-shaped CSVs in results/neo4j/).

    Neo4jGraphStore — runs Cypher against a real Neo4j instance.

The retriever calls `store.build(clip_id)` and works against the returned
in-memory `Graph` regardless of where it came from. New backends (DuckDB,
Memgraph, Kuzu, whatever) drop in by implementing the same interface.
"""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from schemas import GraphEdge, GraphNode

# ---------------------------------------------------------------------------
# In-memory graph (what the retriever walks)
# ---------------------------------------------------------------------------


@dataclass
class Graph:
    """Adjacency-list graph indexed by node id."""

    clip_id: str
    nodes: dict[str, GraphNode] = field(default_factory=dict)
    edges: list[GraphEdge] = field(default_factory=list)
    _adj_out: dict[str, list[GraphEdge]] = field(default_factory=dict)
    _adj_in: dict[str, list[GraphEdge]] = field(default_factory=dict)

    def add_node(self, node: GraphNode) -> None:
        self.nodes[node.id] = node

    def add_edge(self, src: str, dst: str, type_: str) -> None:
        e = GraphEdge(src=src, dst=dst, type=type_)
        self.edges.append(e)
        self._adj_out.setdefault(src, []).append(e)
        self._adj_in.setdefault(dst, []).append(e)

    def neighbors(self, node_id: str) -> Iterable[tuple[GraphEdge, str]]:
        for e in self._adj_out.get(node_id, []):
            yield e, e.dst
        for e in self._adj_in.get(node_id, []):
            yield e, e.src

    def by_kind(self, kind: str) -> list[GraphNode]:
        return [n for n in self.nodes.values() if n.kind == kind]


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class GraphStore:
    """Interface every backend implements."""

    def list_clips(self) -> list[str]:
        raise NotImplementedError

    def build(self, clip_id: str) -> Graph:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# JSONGraphStore — reads the IndustReal pipeline outputs directly
# ---------------------------------------------------------------------------


# Heuristic mapping from a step description to the readable phase from
# industreal_neo4j_guide.md. The CSV exports already encode this — for the
# pure-JSON path we re-derive it the same way the exporter does.
def _phase_for_step(desc: str) -> str:
    d = desc.lower()
    if "chassis pin" in d:
        return "connector_installation"
    if "bracket" in d:
        return "bracket_assembly"
    if "wheel" in d:
        return "wheel_assembly"
    if "chassis" in d:
        return "chassis_assembly"
    return "initial_setup"


# Target components for the final CAD state (state 22) — every clip targets
# the same legal final state.
TARGET_COMPONENTS_STATE22 = [
    "base", "front chassis", "front chassis pin", "short rear chassis",
    "front rear chassis pin", "rear rear chassis pin", "front bracket",
    "front bracket screw", "front wheel assy", "rear wheel assy",
]


class JSONGraphStore(GraphStore):
    """Walks results/raw_cad_pilot/<run>/<clip>/assembly_graph.json + *_results.json."""

    def __init__(self, results_root: str | Path) -> None:
        self.root = Path(results_root)
        if not self.root.exists():
            raise FileNotFoundError(f"results root not found: {self.root}")

        self._clip_index: dict[str, Path] = {}
        for ag in self.root.rglob("*_results.json"):
            clip_id = ag.stem.replace("_results", "")
            self._clip_index[clip_id] = ag

        self._components_csv: Path | None = None
        for csv_path in self.root.rglob("nodes_components.csv"):
            self._components_csv = csv_path
            break

    def list_clips(self) -> list[str]:
        return sorted(self._clip_index.keys())

    def build(self, clip_id: str) -> Graph:
        results_path = self._clip_index.get(clip_id)
        if not results_path:
            raise KeyError(f"unknown clip: {clip_id}")

        with results_path.open() as f:
            res = json.load(f)

        graph = Graph(clip_id=clip_id)

        # Clip
        clip_node_id = f"clip::{clip_id}"
        graph.add_node(GraphNode(
            id=clip_node_id, kind="Clip", label=clip_id,
            props={
                "n_frames": res.get("n_frames"),
                "duration_s": res.get("duration_s"),
                "metrics": res.get("metrics", {}),
            },
        ))

        # Goal
        goal_id = f"goal::{clip_id}"
        graph.add_node(GraphNode(
            id=goal_id, kind="Goal", label="Reach final CAD assembly state",
            props={
                "target_state_index": 22,
                "target_state_name": "11101111111",
                "target_state_asset": "part_geometries/state22.fbx",
                "target_components": TARGET_COMPONENTS_STATE22,
            },
        ))
        graph.add_edge(clip_node_id, goal_id, "HAS_GOAL")

        # Phases. We use the canonical six the exporter produces; in practice
        # only the ones with observed events are interesting. We add all
        # six so NEXT_PHASE chains correctly.
        phase_defs = [
            ("initial_setup", "Initial setup", 1),
            ("chassis_assembly", "Chassis assembly", 2),
            ("connector_installation", "Connector installation", 3),
            ("bracket_assembly", "Bracket assembly", 4),
            ("wheel_assembly", "Wheel assembly", 5),
            ("correction_handling", "Correction handling", 6),
        ]
        phase_ids: dict[str, str] = {}
        prev_phase_id: str | None = None
        for key, name, order in phase_defs:
            pid = f"phase::{clip_id}::{key}"
            phase_ids[key] = pid
            graph.add_node(GraphNode(
                id=pid, kind="Phase", label=name,
                props={"order": order, "phase_key": key},
            ))
            graph.add_edge(goal_id, pid, "HAS_PHASE")
            if prev_phase_id:
                graph.add_edge(prev_phase_id, pid, "NEXT_PHASE")
            prev_phase_id = pid

        # Components — only those that appear in this clip, plus all goal
        # target components (so refusal answers can point at the goal).
        components_in_clip: set[str] = set()
        for s in res.get("gt_steps", []):
            comp = s["description"].replace("Install ", "")
            components_in_clip.add(comp)
        for c in TARGET_COMPONENTS_STATE22:
            components_in_clip.add(c)

        for comp in components_in_clip:
            cid = f"industreal_component::{comp.replace(' ', '_')}"
            graph.add_node(GraphNode(
                id=cid, kind="Component", label=comp,
                props={"normalized_name": comp.replace(" ", "_")},
            ))
            if comp in TARGET_COMPONENTS_STATE22:
                graph.add_edge(goal_id, cid, "TARGETS_COMPONENT")

        # Events
        prev_event_id: str | None = None
        for i, s in enumerate(sorted(res.get("gt_steps", []), key=lambda x: (x["frame"], x["id"]))):
            comp = s["description"].replace("Install ", "")
            phase_key = _phase_for_step(s["description"])
            ev_id = f"event::{clip_id}::{i}"
            graph.add_node(GraphNode(
                id=ev_id, kind="Event", label=s["description"],
                props={
                    "step_id": s["id"], "frame": s["frame"], "time_s": s["time_s"],
                    "event_type": "INSTALL", "conf": s["conf"],
                    "component_name": comp, "phase_key": phase_key, "local_order": i,
                },
            ))
            graph.add_edge(phase_ids[phase_key], ev_id, "HAS_STEP")
            graph.add_edge(ev_id, f"industreal_component::{comp.replace(' ', '_')}", "ACTS_ON")
            if prev_event_id:
                graph.add_edge(prev_event_id, ev_id, "NEXT")
            prev_event_id = ev_id

        return graph


# ---------------------------------------------------------------------------
# Neo4jGraphStore — same interface, Cypher
# ---------------------------------------------------------------------------


class Neo4jGraphStore(GraphStore):
    """Loads a clip subgraph from a real Neo4j database."""

    def __init__(self, uri: str, user: str, password: str) -> None:
        # Import here so JSON-only deployments don't need the driver.
        from neo4j import GraphDatabase  # type: ignore

        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def list_clips(self) -> list[str]:
        with self.driver.session() as s:
            r = s.run("MATCH (c:IndustRealClip) RETURN DISTINCT c.clip AS clip ORDER BY clip")
            return [rec["clip"] for rec in r]

    def build(self, clip_id: str) -> Graph:
        graph = Graph(clip_id=clip_id)
        # One pass to grab every node in the clip's subgraph along with its
        # labels and properties — then a second pass for edges.
        with self.driver.session() as s:
            nodes_query = """
                MATCH (c:IndustRealClip {clip: $clip})
                OPTIONAL MATCH p = (c)-[*1..3]-(n)
                WITH collect(DISTINCT c) + collect(DISTINCT n) AS all_nodes
                UNWIND all_nodes AS node
                RETURN DISTINCT id(node) AS nid, labels(node) AS labels,
                                properties(node) AS props
            """
            for rec in s.run(nodes_query, clip=clip_id):
                if rec["nid"] is None:
                    continue
                kind = _pick_kind(rec["labels"])
                if not kind:
                    continue
                props = dict(rec["props"])
                nid = str(rec["nid"])
                label = props.get("display_name") or props.get("name") or props.get("clip") or nid
                graph.add_node(GraphNode(id=nid, kind=kind, label=label, props=props))

            edges_query = """
                MATCH (c:IndustRealClip {clip: $clip})
                OPTIONAL MATCH (c)-[*1..3]-(:* )
                WITH c
                MATCH (a)-[r]->(b)
                WHERE (a)-[:HAS_GOAL|HAS_PHASE|HAS_STEP|ACTS_ON|TARGETS_COMPONENT|NEXT|NEXT_PHASE]-(c)
                   OR (b)-[:HAS_GOAL|HAS_PHASE|HAS_STEP|ACTS_ON|TARGETS_COMPONENT|NEXT|NEXT_PHASE]-(c)
                RETURN DISTINCT id(a) AS src, id(b) AS dst, type(r) AS t
            """
            for rec in s.run(edges_query, clip=clip_id):
                src = str(rec["src"]); dst = str(rec["dst"]); t = rec["t"]
                if src in graph.nodes and dst in graph.nodes:
                    graph.add_edge(src, dst, t)
        return graph


def _pick_kind(labels: list[str]) -> str | None:
    """Map Neo4j labels (often multiple) to our schema's NodeKind."""
    s = set(labels)
    if "AssemblyGoal" in s or "CADAssemblyGoal" in s:
        return "Goal"
    if "AssemblyPhase" in s:
        return "Phase"
    if "AssemblyEvent" in s or "ProcedureStep" in s:
        return "Event"
    if "Component" in s or "IndustRealComponent" in s:
        return "Component"
    if "IndustRealClip" in s or "Recording" in s:
        return "Clip"
    return None
