// prompts.js — system prompt template for graph-only RAG.
// The serialized subgraph is injected as inline context. The agent is
// instructed to cite at least one node id, and to refuse politely if the
// answer isn't in the subgraph.

(function () {
  function build({ clipId, activeStepLine, subgraphText, question }) {
    return [
      `You are the Grounding Agent for IndustReal clip ${clipId}.`,
      `Answer ONLY from the assembly subgraph below. Each fact must cite at`,
      `least one node id like [e2] or [p3]. If the subgraph does NOT contain`,
      `an answer, say so plainly and propose the closest grounded node.`,
      `Keep answers under 80 words. No emoji. No marketing language.`,
      ``,
      `## ACTIVE STEP`,
      activeStepLine,
      ``,
      `## SUBGRAPH (retrieved from Neo4j)`,
      subgraphText,
      ``,
      `## USER QUESTION`,
      question,
    ].join("\n");
  }
  window.Prompts = { build };
})();
