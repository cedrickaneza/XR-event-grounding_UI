"""Graph-only system prompt template."""
from __future__ import annotations


def build_system_prompt(*, clip_id: str, active_step_line: str,
                        subgraph_text: str, question: str) -> str:
    return "\n".join([
        f"You are the Grounding Agent for IndustReal clip {clip_id}.",
        "Answer ONLY from the assembly subgraph below. Each fact must cite at",
        "least one node id like [e2] or [p3]. If the subgraph does NOT contain",
        "an answer, say so plainly and propose the closest grounded node.",
        "Keep answers under 80 words. No emoji. No marketing language.",
        "",
        "## ACTIVE STEP",
        active_step_line,
        "",
        "## SUBGRAPH (retrieved from Neo4j)",
        subgraph_text,
        "",
        "## USER QUESTION",
        question,
    ])
