"""Pydantic schemas for the REST API."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


NodeKind = Literal["Clip", "Goal", "Phase", "Event", "Component"]


class GraphNode(BaseModel):
    id: str
    kind: NodeKind
    label: str
    props: dict[str, Any] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    src: str
    dst: str
    type: str


class Subgraph(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    seeds: list[str]
    active_event_id: str | None = None
    question: str | None = None


class Citation(BaseModel):
    short_id: str
    node: GraphNode


class QueryRequest(BaseModel):
    clip_id: str
    active_event_id: str | None = None
    question: str
    depth: int = 2
    top_k: int = 14
    llm: str = "openai-gpt4o"


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]
    subgraph: Subgraph
    confidence: float
    llm: str


class TTSRequest(BaseModel):
    text: str
    voice: str = "elevenlabs"


class ClipSummary(BaseModel):
    id: str
    n_frames: int
    duration_s: float
    n_events: int


class ProvidersResponse(BaseModel):
    llm: list[dict[str, Any]]
    tts: list[dict[str, Any]]
