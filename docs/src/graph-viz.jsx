// graph-viz.jsx — animated SVG of the retrieved subgraph.
//
// Layout: tiered by node kind. Goal (top), Phases, Events, Components. We
// position nodes in lanes, then route edges with simple cubic curves. When a
// fresh subgraph arrives we play a brief BFS-style reveal animation so the
// user can SEE the retrieval walking the graph rather than just appearing.
//
// Two surfaces consume this component:
//   - the inline thumbnail under each AI answer (compact = true)
//   - the full-screen overlay launched from a chip
//
// The viz is purely a function of the subgraph object — no parallel state.

const { useEffect, useMemo, useRef, useState } = React;

function GraphViz({ subgraph, compact = false }) {
  if (!subgraph || !subgraph.nodes) {
    return <div className="fg-3" style={{ padding: 24 }}>(no subgraph yet)</div>;
  }
  const W = compact ? 640 : 1040;
  const H = compact ? 220 : 600;
  const layout = useMemo(() => layoutTiered(subgraph, W, H), [subgraph, W, H]);

  const maxDist = Math.max(1, ...layout.nodes.map((n) => n.dist));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="gv-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="gv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10" fill="var(--accent-500)" />
        </marker>
        <marker id="gv-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10" fill="var(--border-2)" />
        </marker>
      </defs>

      {/* Edges first (under nodes) */}
      {layout.edges.map((e, i) => {
        const a = layout.nodeMap.get(e.from);
        const b = layout.nodeMap.get(e.to);
        if (!a || !b) return null;
        const isActive = a.active && b.active;
        // Edges between seeds get the marching-dash "traversing" treatment so
        // the most-relevant retrieval path stands out. Non-seed edges read as
        // ambient connections.
        const traversing = a.seed && b.seed;
        const path = curvePath(a, b);
        return (
          <path
            key={i}
            className={"gv-edge" + (isActive ? " active" : "") + (traversing ? " traversing" : "")}
            d={path}
            markerEnd={isActive ? "url(#gv-arrow)" : "url(#gv-arrow-dim)"}
          />
        );
      })}

      {/* Nodes */}
      {layout.nodes.map((n) => (
        <g
          key={n.id}
          className={"gv-node kind-" + n.kind.toLowerCase() + (n.active ? " active" : "") + (n.seed ? " seed" : "")}
          transform={`translate(${n.x}, ${n.y})`}
        >
          {n.kind === "Goal" ? (
            <circle className="node-shape" r={compact ? 22 : 32} />
          ) : n.kind === "Component" ? (
            <circle className="node-shape" r={compact ? 16 : 22} />
          ) : (
            <rect
              className="node-shape"
              x={-n.w / 2} y={-n.h / 2}
              width={n.w} height={n.h}
              rx={compact ? 4 : 6}
            />
          )}
          <text className="kind-lbl" y={-n.h / 2 - 6} textAnchor="middle">{kindLabel(n.kind)}</text>
          <text className="lbl" y={4} textAnchor="middle">
            {truncate(n.label, compact ? 12 : 18)}
          </text>
          {n.subLabel && (
            <text className="lbl" y={n.h / 2 + 12} textAnchor="middle"
                  style={{ fontSize: compact ? 8 : 9, fill: "var(--fg-4)" }}>
              {n.subLabel}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function kindLabel(k) {
  return k.toLowerCase();
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Tiered layout — each kind gets its own row. Within a row, nodes are
// distributed evenly. For the Events row we sort by their `local_order` so
// the time ordering reads left-to-right.
function layoutTiered(subgraph, W, H) {
  const margin = 24;
  const tiers = ["Clip", "Goal", "Phase", "Event", "Component"];
  const byKind = new Map();
  subgraph.nodes.forEach((n) => {
    if (!byKind.has(n.kind)) byKind.set(n.kind, []);
    byKind.get(n.kind).push(n);
  });

  // Skip empty kinds.
  const usedTiers = tiers.filter((k) => (byKind.get(k) || []).length > 0);
  const rowH = (H - margin * 2) / Math.max(1, usedTiers.length);

  const seedIds = new Set(subgraph.seeds || []);
  const activeId = subgraph.activeEventId;

  // BFS distance for animation order. We approximate using the edges already
  // in the subgraph (since the original distances aren't carried through).
  const dist = computeDistances(subgraph);

  const nodes = [];
  usedTiers.forEach((kind, row) => {
    const items = (byKind.get(kind) || []).slice();
    if (kind === "Event") items.sort((a, b) => (a.props.local_order ?? 0) - (b.props.local_order ?? 0));
    if (kind === "Phase") items.sort((a, b) => (a.props.order ?? 0) - (b.props.order ?? 0));

    const n = items.length;
    const colW = (W - margin * 2) / Math.max(1, n);
    items.forEach((node, col) => {
      const x = margin + colW * (col + 0.5);
      const y = margin + rowH * (row + 0.5);
      const w =
        kind === "Goal" || kind === "Component" ? 60 :
        kind === "Phase" ? Math.min(140, colW - 12) :
        Math.min(130, colW - 8);
      const h = kind === "Phase" || kind === "Event" ? 36 : 50;
      const isActive = true; // every node in the subgraph IS active (it was retrieved)
      const isSeed = seedIds.has(node.id) || node.id === activeId;
      nodes.push({
        id: node.id,
        kind,
        label:
          kind === "Event" ? "step #" + (node.props.step_id ?? node.props.local_order) :
          kind === "Phase" ? node.label.replace(" assembly", " asm").replace(" installation", " inst") :
          node.label,
        subLabel:
          kind === "Event" ? `${node.props.time_s?.toFixed(1)}s` :
          kind === "Component" ? null :
          null,
        x, y, w, h,
        active: isActive, seed: isSeed,
        dist: dist.get(node.id) ?? 0,
      });
    });
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, edges: subgraph.edges, nodeMap };
}

function computeDistances(subgraph) {
  const seeds = subgraph.seeds && subgraph.seeds.length ? subgraph.seeds : [subgraph.activeEventId];
  const dist = new Map();
  seeds.forEach((id) => dist.set(id, 0));
  const queue = seeds.slice();
  const adj = new Map();
  subgraph.edges.forEach((e) => {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to))   adj.set(e.to, []);
    adj.get(e.from).push(e.to);
    adj.get(e.to).push(e.from);
  });
  while (queue.length) {
    const id = queue.shift();
    const d = dist.get(id);
    (adj.get(id) || []).forEach((nb) => {
      if (!dist.has(nb)) { dist.set(nb, d + 1); queue.push(nb); }
    });
  }
  return dist;
}

function curvePath(a, b) {
  // Cubic curve from a to b, bowed in the direction of travel.
  const dy = b.y - a.y;
  const cx1 = a.x;
  const cy1 = a.y + dy * 0.5;
  const cx2 = b.x;
  const cy2 = b.y - dy * 0.5;
  return `M ${a.x} ${a.y + a.h / 2} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${b.x} ${b.y - b.h / 2}`;
}

// ---------------------------------------------------------------------------
// Graph overlay (modal-size)
// ---------------------------------------------------------------------------
function GraphOverlay({ subgraph, onClose }) {
  if (!subgraph) return null;
  return (
    <div className="graph-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head-x">
          <div>
            <span className="mono-caps">Retrieval graph · live</span>
            <h3 className="mt-1">Subgraph used to answer "{truncate(subgraph.question, 60)}"</h3>
          </div>
          <button className="btn ghost" onClick={onClose}>Close ×</button>
        </div>
        <div className="panel-body">
          <GraphViz subgraph={subgraph} />
        </div>
        <div className="panel-foot">
          <div className="flex gap-3 ai-center">
            <span className="mono-caps">{subgraph.nodes.length} nodes · {subgraph.edges.length} edges</span>
            <span className="fg-3" style={{ fontSize: 13 }}>
              The model saw exactly these nodes — nothing else from the full graph.
            </span>
          </div>
          <div className="flex gap-2">
            <button className="btn compact">Export Cypher</button>
            <button className="btn compact">Copy serialized</button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { GraphViz, GraphOverlay });
