// retriever.js
// Graph-only RAG for the assembly graph.
//
// Two stages:
//
//   1. retrieve(question, activeEventId, opts) -> Subgraph
//      Picks a small set of nodes that should ground the answer. Algorithm:
//        a. Seed from the active Event node (+ its phase, component, goal).
//        b. BFS outward to `depth` hops, expanding through any edge type.
//        c. Score each candidate by keyword overlap with the question, then
//           by edge-distance to the seed (closer is better).
//        d. Keep the top-k.
//
//   2. serialize(subgraph) -> { text, refs }
//      Turns the subgraph into a compact text block the LLM can read inline
//      in its system prompt. Each node gets a stable short id (g1, p1, e1,
//      c1, …) so the answer can cite "[e1]" instead of full UUIDs.
//
// The visualization re-uses the SAME subgraph object so the UI shows exactly
// what the model was given. No hidden context.

(function () {
  const STOP = new Set([
    "the","a","an","is","of","to","do","i","do","does","how","what","why","where","which","when","at","on","in","for","and","or","with","without","this","that","my","me","you","be","are","was","were","it","its","but","by","from","as","can","could","should","would","need","want","use","using","step","steps","next","previous"
  ]);
  function tokens(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  }

  function score(node, qTokens) {
    if (!qTokens.length) return 0;
    const hay = (node.label + " " + Object.values(node.props || {}).join(" ")).toLowerCase();
    let s = 0;
    qTokens.forEach((t) => { if (hay.includes(t)) s += 1; });
    // Boost when phase/component names exactly match a query token.
    qTokens.forEach((t) => { if (node.label.toLowerCase().split(/[\s_]+/).includes(t)) s += 0.5; });
    return s;
  }

  function bfs(graph, seedIds, maxDepth) {
    const dist = new Map();
    seedIds.forEach((id) => dist.set(id, 0));
    const queue = [...seedIds];
    while (queue.length) {
      const id = queue.shift();
      const d = dist.get(id);
      if (d >= maxDepth) continue;
      graph.neighbors(id).forEach((e) => {
        if (!dist.has(e.other)) {
          dist.set(e.other, d + 1);
          queue.push(e.other);
        }
      });
    }
    return dist;
  }

  function retrieve(graph, question, activeEventId, opts = {}) {
    const { depth = 2, topK = 14 } = opts;
    const qTok = tokens(question);

    // Seeds: active event, its phase, its component, the goal.
    const seeds = new Set();
    const active = graph.get(activeEventId);
    if (active) {
      seeds.add(active.id);
      graph.neighbors(active.id).forEach((e) => {
        const other = graph.get(e.other);
        if (other && (other.kind === "Phase" || other.kind === "Component")) {
          seeds.add(other.id);
        }
      });
    }
    // Always seed the goal so refusals can name it.
    [...graph.nodes.values()].filter((n) => n.kind === "Goal").forEach((g) => seeds.add(g.id));

    const dist = bfs(graph, [...seeds], depth);

    // Rank candidates.
    const scored = [...dist.entries()].map(([id, d]) => {
      const node = graph.get(id);
      const isSeed = seeds.has(id);
      return {
        id, d, isSeed,
        node,
        score: score(node, qTok) * 1.5 + (isSeed ? 1.2 : 0) + Math.max(0, 1.5 - d),
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const keep = new Set(scored.slice(0, topK).map((s) => s.id));
    // Always keep seeds.
    seeds.forEach((id) => keep.add(id));

    // Collect kept nodes + edges that connect them.
    const nodes = [...keep].map((id) => graph.get(id)).filter(Boolean);
    const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));

    return { nodes, edges, seeds: [...seeds], activeEventId, question };
  }

  function shortId(node, counts) {
    const prefix = node.kind === "Goal" ? "g" :
                   node.kind === "Phase" ? "p" :
                   node.kind === "Event" ? "e" :
                   node.kind === "Component" ? "c" :
                   node.kind === "Clip" ? "k" : "n";
    counts[prefix] = (counts[prefix] || 0) + 1;
    return prefix + counts[prefix];
  }

  function serialize(subgraph) {
    const counts = {};
    const idMap = new Map();
    const refs = []; // for the UI: short_id -> full_id + node

    subgraph.nodes.forEach((n) => {
      const sid = shortId(n, counts);
      idMap.set(n.id, sid);
      refs.push({ short: sid, node: n });
    });

    const lines = ["NODES:"];
    subgraph.nodes.forEach((n) => {
      const sid = idMap.get(n.id);
      const p = n.props || {};
      let summary = "";
      if (n.kind === "Goal") summary = `target_state=${p.target_state_index} (${p.target_state_name})`;
      else if (n.kind === "Phase") summary = `order=${p.order}, frames=${p.first_frame}-${p.last_frame}, steps=${p.step_count}`;
      else if (n.kind === "Event") summary = `frame=${p.frame}, time=${p.time_s}s, conf=${p.conf}, acts_on=${p.component_name}`;
      else if (n.kind === "Component") summary = `normalized=${p.normalized_name}`;
      else if (n.kind === "Clip") summary = `n_frames=${p.n_frames}, duration=${p.duration_s}s, f1=${p.f1}`;
      lines.push(`  [${sid}] (${n.kind}) "${n.label}" — ${summary}`);
    });

    lines.push("\nEDGES:");
    subgraph.edges.forEach((e) => {
      const a = idMap.get(e.from);
      const b = idMap.get(e.to);
      if (a && b) lines.push(`  [${a}] -[:${e.type}]-> [${b}]`);
    });

    const active = subgraph.nodes.find((n) => n.id === subgraph.activeEventId);
    const activeRef = active ? idMap.get(active.id) : "(none)";

    return {
      text: lines.join("\n"),
      refs,
      idMap,
      activeRef,
    };
  }

  window.Retriever = { retrieve, serialize };
})();
