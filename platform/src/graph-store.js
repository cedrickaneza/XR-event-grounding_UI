// graph-store.js
// Source-of-truth for the assembly graph.
//
// In production the same interface has a Neo4j implementation. Here we walk
// the JSON the IndustReal pipeline already produces — `assembly_graph.json`
// + `*_results.json` + the Neo4j-shaped CSVs — pre-built by data/graph-data.js
// at project-build time.
//
// Edges (matching industreal_neo4j_guide.md):
//   Goal     -[:HAS_PHASE]->          Phase
//   Goal     -[:TARGETS_COMPONENT]->  Component
//   Phase    -[:HAS_STEP]->           Event
//   Phase    -[:NEXT_PHASE]->         Phase
//   Event    -[:ACTS_ON]->            Component
//   Event    -[:NEXT]->               Event

(function () {
  const D = window.INDUSTREAL_DATA;
  if (!D) {
    console.error("graph-data.js must load before graph-store.js");
    return;
  }

  // Build an in-memory index for the active clip. We rebuild when the user
  // switches clips so the retriever can pretend it's hitting a database.
  function buildGraph(clipId) {
    const clip = D.clips[clipId];
    if (!clip) throw new Error("Unknown clip: " + clipId);

    const nodes = new Map();
    const edges = []; // { from, to, type }

    // Run/Mode/Clip — folded into one root node for the demo.
    const clipNode = {
      id: `clip::${clip.id}`,
      kind: "Clip",
      label: clip.id,
      props: {
        n_frames: clip.n_frames,
        duration_s: clip.duration_s,
        f1: clip.metrics?.f1,
        avg_delay_s: clip.metrics?.avg_delay_s,
      },
    };
    nodes.set(clipNode.id, clipNode);

    // Goal
    const goal = {
      id: clip.goal.id,
      kind: "Goal",
      label: clip.goal.name,
      props: {
        target_state_index: clip.goal.target_state_index,
        target_state_name: clip.goal.target_state_name,
        target_state_asset: clip.goal.target_state_asset,
      },
    };
    nodes.set(goal.id, goal);
    edges.push({ from: clipNode.id, to: goal.id, type: "HAS_GOAL" });

    // Phases
    const phaseById = new Map();
    clip.phases.forEach((p, i) => {
      const id = `phase::${clip.id}::${p.id}`;
      const node = {
        id,
        kind: "Phase",
        label: p.name,
        props: {
          order: p.order,
          phase_key: p.id,
          first_frame: p.first_frame,
          last_frame: p.last_frame,
          step_count: p.step_count,
          status: p.status,
        },
      };
      nodes.set(id, node);
      phaseById.set(p.id, node);
      edges.push({ from: goal.id, to: id, type: "HAS_PHASE" });
      if (i > 0) {
        const prev = phaseById.get(clip.phases[i - 1].id);
        edges.push({ from: prev.id, to: id, type: "NEXT_PHASE" });
      }
    });

    // Components — only ones reachable from this clip's goal/events.
    const compIndex = new Map(D.components.map((c) => [c.name, c]));
    function ensureComponent(name) {
      const c = compIndex.get(name);
      if (!c) return null;
      if (!nodes.has(c.id)) {
        nodes.set(c.id, {
          id: c.id,
          kind: "Component",
          label: c.name,
          props: { normalized_name: c.normalized },
        });
      }
      return nodes.get(c.id);
    }
    clip.goal.target_components.forEach((name) => {
      const c = ensureComponent(name);
      if (c) edges.push({ from: goal.id, to: c.id, type: "TARGETS_COMPONENT" });
    });

    // Events (steps) — and link each into its phase + acted-on component.
    const sortedEvents = [...clip.events].sort((a, b) => a.frame - b.frame || a.local_id - b.local_id);
    sortedEvents.forEach((ev, i) => {
      const node = {
        id: ev.id,
        kind: "Event",
        label: ev.action_desc,
        props: {
          step_id: ev.step_id,
          frame: ev.frame,
          time_s: ev.time_s,
          event_type: ev.event_type,
          conf: ev.conf,
          component_name: ev.component,
          phase_key: ev.phase_key,
          local_order: i,
        },
      };
      nodes.set(node.id, node);

      const phase = phaseById.get(ev.phase_key);
      if (phase) edges.push({ from: phase.id, to: node.id, type: "HAS_STEP" });
      else edges.push({ from: goal.id, to: node.id, type: "HAS_STEP" });

      const comp = ensureComponent(ev.component);
      if (comp) edges.push({ from: node.id, to: comp.id, type: "ACTS_ON" });

      if (i > 0) {
        edges.push({ from: sortedEvents[i - 1].id, to: node.id, type: "NEXT" });
      }
    });

    // Adjacency index for fast BFS.
    const adjOut = new Map();
    const adjIn = new Map();
    edges.forEach((e) => {
      if (!adjOut.has(e.from)) adjOut.set(e.from, []);
      if (!adjIn.has(e.to))   adjIn.set(e.to, []);
      adjOut.get(e.from).push(e);
      adjIn.get(e.to).push(e);
    });

    return {
      clipId,
      clip,
      nodes,
      edges,
      adjOut,
      adjIn,
      neighbors(id) {
        return [
          ...(adjOut.get(id) || []).map((e) => ({ ...e, dir: "out", other: e.to })),
          ...(adjIn.get(id)  || []).map((e) => ({ ...e, dir: "in",  other: e.from })),
        ];
      },
      get(id) { return nodes.get(id); },
      eventsInOrder() {
        return [...nodes.values()].filter((n) => n.kind === "Event").sort((a, b) => a.props.local_order - b.props.local_order);
      },
      phasesInOrder() {
        return [...nodes.values()].filter((n) => n.kind === "Phase").sort((a, b) => a.props.order - b.props.order);
      },
    };
  }

  window.GraphStore = {
    listClips() { return Object.keys(D.clips); },
    build: buildGraph,
  };
})();
