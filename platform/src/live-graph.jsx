// live-graph.jsx — Animated Neo4j-style construction graph that builds itself
// up as the video / timeline progresses. Used for the "Live Graph" tab.
//
// Why this exists:
//   The Instruction tab shows a *retrieved* subgraph after each chat question.
//   For presentations we want the opposite: show the full assembly knowledge
//   graph and have it materialize node-by-node as the operator does the work,
//   so the audience can see what the AI is actually grounded in.
//
// Layout — tiered Neo4j-style tree:
//   Clip (lavender) → Goal (coral) → Phases (periwinkle) →
//   Events (teal) → Components (olive)
//   Phases form the structural scaffold and are visible from the start.
//   Events + Components pop in once their time_s passes the current playhead.
//
// Animation strategy:
//   Each node carries a `revealTime` (seconds in the clip). The current
//   playhead = progress * duration. CSS transitions on opacity + transform
//   handle the pop-in; the currently-active event gets a soft drop-shadow glow.
//
//   IMPORTANT: events that share the same `time_s` (e.g. "install part" +
//   "install pin" at the same frame) are staggered visually so they cascade
//   in one-by-one for presentations, rather than popping in simultaneously.
//   The video sync is unaffected — only the reveal animation is offset by
//   sub-second amounts. See TIE_STAGGER_S in computeLayout.

const { useEffect, useMemo, useRef, useState, useCallback } = React;

// Neo4j-style pastel palette to match the reference screenshot.
const PALETTES = {
  neo4j: {
    Clip:      { fill: "#dccdf6", stroke: "#a48fd1", text: "#3d2d62", r: 48, kindLabel: "Clip" },
    Goal:      { fill: "#f4a895", stroke: "#d67862", text: "#5c2418", r: 60, kindLabel: "Goal" },
    Phase:     { fill: "#a8b6f5", stroke: "#6f81d8", text: "#1f2a5c", r: 48, kindLabel: "Phase" },
    Event:     { fill: "#84dccc", stroke: "#3eb29c", text: "#0f4a3e", r: 44, kindLabel: "Step" },
    Component: { fill: "#c4c884", stroke: "#8a8f4d", text: "#3a3d18", r: 38, kindLabel: "Part" },
  },
  // Warm/earthy alt — same hierarchy, less saturated, presentation-friendly.
  warm: {
    Clip:      { fill: "#e8dcc0", stroke: "#b89e6c", text: "#4a3a1c", r: 48, kindLabel: "Clip" },
    Goal:      { fill: "#e8a07a", stroke: "#c2734a", text: "#5c2818", r: 60, kindLabel: "Goal" },
    Phase:     { fill: "#d4b89c", stroke: "#a8845e", text: "#3d2818", r: 48, kindLabel: "Phase" },
    Event:     { fill: "#9cc4a0", stroke: "#5e9268", text: "#1f3a26", r: 44, kindLabel: "Step" },
    Component: { fill: "#c4b884", stroke: "#8a824d", text: "#3a3618", r: 38, kindLabel: "Part" },
  },
  // Mono — grayscale, lets the action of revealing nodes carry the eye.
  mono: {
    Clip:      { fill: "#e8e6df", stroke: "#a8a59c", text: "#2a2820", r: 48, kindLabel: "Clip" },
    Goal:      { fill: "#d4d2c8", stroke: "#8c8a80", text: "#1a1810", r: 60, kindLabel: "Goal" },
    Phase:     { fill: "#c0bdb2", stroke: "#78766c", text: "#1a1810", r: 48, kindLabel: "Phase" },
    Event:     { fill: "#a8a59c", stroke: "#605c54", text: "#0a0805", r: 44, kindLabel: "Step" },
    Component: { fill: "#8c8a80", stroke: "#48463e", text: "#f1efe2", r: 38, kindLabel: "Part" },
  },
};
const NEO = PALETTES.neo4j; // legacy alias — used where the palette isn't yet plumbed

function LiveGraphView(props) {
  const {
    graph, activeEventId, progress, playing,
    onTogglePlay, onScrub, onJumpEvent,
    videoUrl, onVideoUrl,
  } = props;

  // ---------- Tweakable visual options ----------
  // Read defaults from the inline EDITMODE block in Platform.html so the host
  // can persist user choices to disk via __edit_mode_set_keys.
  const [tweaks, setTweak] = useTweaks(window.LG_TWEAK_DEFAULTS || {
    stagger_s: 0.45,
    show_dots: true,
    show_phase_bands: true,
    show_playhead: true,
    show_edge_labels: true,
    active_glow: "breathing",
    palette: "neo4j",
  });
  const PAL = PALETTES[tweaks.palette] || PALETTES.neo4j;

  const clip = graph.clip;
  const events = graph.eventsInOrder();
  const activeEvent = graph.get(activeEventId);
  const currentTime = progress * clip.duration_s;

  // Layout dims — viewBox stays fixed; outer container scales it.
  // Aspect chosen wide-ish (~2.4:1) so the graph fills a typical 16:9 area
  // after the header + controls eat ~250px of vertical space.
  const W = 1600;
  const H = 720;
  const layout = useMemo(
    () => computeLayout(graph, W, H, PAL, tweaks.stagger_s),
    [graph, PAL, tweaks.stagger_s]
  );

  // Effective (staggered) reveal time for each event — used for stats
  // and active-event snap so the visible cascade and the highlight line up.
  const revealOf = (ev) => layout.eventReveal.get(ev.id) ?? ev.props.time_s;

  // Stats for the header readout — count what's *visible*, not what's fired.
  const firedCount = events.filter((e) => currentTime >= revealOf(e) - 0.01).length;
  const seenComps = new Set();
  events.forEach((e) => {
    if (currentTime >= revealOf(e) - 0.01) seenComps.add(e.props.component_name);
  });

  // ---------- Video PiP ----------
  const videoRef = useRef(null);
  const fileRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Playback flow (unidirectional — the previous design glitched because both
  // sides wrote to each other):
  //
  //   sources of truth:
  //     • <video>.currentTime when a video is loaded — we POLL it via rAF
  //       while playing and write the ratio to `progress`. Never write back.
  //     • a real-time rAF simulator when there's no video. Increments `progress`
  //       by dt/duration each frame.
  //
  //   user actions:
  //     • scrubber click / reset → call `seekTo(p)` — the ONLY path that ever
  //       writes `video.currentTime`. Also sets `progress`.
  //     • play/pause toggles the simulator or the video element directly.
  //
  // No more progress→video→progress feedback loop. No delta thresholds.
  // ---------------------------------------------------------------------------

  // Poll the video element while playing.
  useEffect(() => {
    if (!playing || !videoUrl) return;
    let raf;
    const poll = () => {
      const v = videoRef.current;
      if (v && v.duration > 0 && !v.seeking) {
        const p = v.currentTime / v.duration;
        if (p <= 1) onScrub(p);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [playing, videoUrl, onScrub]);

  // Play/pause the video element when state flips.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, videoUrl]);

  // Auto-advance progress when no video is loaded (presentation mode).
  useEffect(() => {
    if (!playing || videoUrl) return;
    let raf, lastT = performance.now();
    const tick = (now) => {
      const dt = (now - lastT) / 1000;
      lastT = now;
      onScrub((p) => Math.min(1, p + dt / clip.duration_s));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, videoUrl, clip.duration_s, onScrub]);

  // Explicit user-driven seek: writes BOTH the video and the progress state.
  // Wrapped in useCallback so the scrubber + reset button get a stable
  // reference.
  const seekTo = useCallback((p) => {
    const clamped = Math.max(0, Math.min(1, p));
    const v = videoRef.current;
    if (v && videoUrl && v.duration > 0) {
      v.currentTime = clamped * v.duration;
    }
    onScrub(clamped);
  }, [videoUrl, onScrub]);

  function onFile(e) {
    const f = e.target.files?.[0];
    if (f) onVideoUrl(URL.createObjectURL(f));
  }

  // Snap to the most-recently-revealed event when progress moves (so the
  // active highlight rides along with the cascading reveal — for tied
  // events at the same time_s, this means the caption steps through each
  // one in turn rather than jumping straight to the last).
  //
  // The progress polling fires at ~60Hz; checking against every event on
  // every tick + dispatching state updates was the load that made event
  // ticks feel like a hitch. We now only fire onJumpEvent when crossing
  // a boundary by comparing against a ref — zero React state updates while
  // we're between events.
  const lastSnappedRef = useRef(null);
  useEffect(() => {
    const ordered = [...events].sort((a, b) => revealOf(a) - revealOf(b));
    let best = null;
    for (const e of ordered) {
      if (currentTime >= revealOf(e) - 0.01) best = e;
      else break;
    }
    const bestId = best?.id ?? null;
    if (bestId !== lastSnappedRef.current) {
      lastSnappedRef.current = bestId;
      if (bestId) onJumpEvent(bestId);
    }
  }, [progress]); // eslint-disable-line

  // ---------- Scrubber ----------
  function onScrubClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(p);
  }

  return (
    <main className="lg-root">
      <div className="lg-header">
        <div>
          <span className="mono-caps">Live construction · presentation view</span>
          <h2 className="mt-1">Clip {clip.id} · assembly graph builds in real time</h2>
          <p className="mt-2 fg-3" style={{ fontSize: 14, maxWidth: 760 }}>
            Each step the operator performs spawns an <code>Event</code> node and an{" "}
            <code>ACTS_ON</code> edge to the part it touches. This is exactly the
            structure the agent retrieves over — visualized as it forms.
          </p>
        </div>
        <div className="lg-stats">
          <Stat label="elapsed"   value={currentTime.toFixed(1) + "s"} />
          <Stat label="steps"     value={firedCount + " / " + events.length} />
          <Stat label="parts"     value={seenComps.size + ""} />
          <Stat label="phases"    value={layout.visiblePhases + ""} />
        </div>
      </div>

      <div className="lg-canvas-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="lg-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="lg-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.10" />
            </filter>
            {/* Subtle dotted grid — reads as a "graph canvas" without
                competing with the colorful nodes. */}
            <pattern id="lg-dots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="rgba(0,0,0,0.07)" />
            </pattern>
          </defs>

          {tweaks.show_dots && (
            <rect width={W} height={H} fill="url(#lg-dots)" />
          )}

          {/* Phase bands — vertical columns behind each phase. Helps the
              audience see which step belongs to which phase at a glance. */}
          {tweaks.show_phase_bands && layout.phaseBands.map((b, i) => (
            <g key={"band-" + i}>
              <rect
                x={b.x} y={120} width={b.w} height={H - 140}
                fill={i % 2 === 0 ? "rgba(168, 182, 245, 0.07)" : "transparent"}
              />
              <text
                x={b.x + b.w / 2} y={108}
                textAnchor="middle"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  fill: "#7a786c",
                  pointerEvents: "none",
                }}
              >
                {b.label}
              </text>
            </g>
          ))}

          {/* Playhead — thin vertical line riding the current event's column,
              so the audience can see the visual link between the timeline
              and the part of the graph that just lit up. */}
          {tweaks.show_playhead && activeEvent && (() => {
            const x = layout.nodeById.get(activeEvent.id)?.x;
            if (x == null) return null;
            return (
              <line
                x1={x} y1={140} x2={x} y2={H - 30}
                stroke={PAL.Event.stroke}
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.45"
                style={{ transition: "x1 0.4s ease-out, x2 0.4s ease-out" }}
              />
            );
          })()}

          {/* Edges under nodes */}
          {layout.edges.map((e, i) => (
            <EdgeView
              key={i}
              edge={e}
              layout={layout}
              palette={PAL}
              currentTime={currentTime}
              showLabel={tweaks.show_edge_labels}
            />
          ))}

          {/* Nodes */}
          {layout.nodes.map((n) => (
            <NodeView
              key={n.id}
              node={n}
              palette={PAL}
              currentTime={currentTime}
              isActive={n.id === activeEventId}
              activeGlow={tweaks.active_glow}
              onJump={n.kind === "Event" ? () => onJumpEvent(n.id) : null}
            />
          ))}
        </svg>

        <VideoPiP
          clipId={clip.id}
          videoUrl={videoUrl}
          videoRef={videoRef}
          fileRef={fileRef}
          onFile={onFile}
          activeEvent={activeEvent}
        />
      </div>

      <div className="lg-controls">
        <button
          className="btn primary lg-play"
          onClick={onTogglePlay}
          title={playing ? "Pause" : "Play / simulate"}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          className="btn"
          onClick={() => seekTo(0)}
          title="Reset to start"
        >
          ↺ Reset
        </button>

        <div className="lg-scrubber" onClick={onScrubClick}>
          <div className="fill" style={{ width: `${progress * 100}%` }} />
          <div className="knob" style={{ left: `${progress * 100}%` }} />
          {events.map((ev) => {
            const ratio = ev.props.time_s / clip.duration_s;
            const fired = currentTime >= revealOf(ev) - 0.01;
            return (
              <div
                key={ev.id}
                className="tick"
                title={ev.label + " · " + ev.props.time_s.toFixed(1) + "s"}
                style={{
                  left: `${ratio * 100}%`,
                  background: ev.id === activeEventId
                    ? PAL.Event.stroke
                    : fired ? PAL.Event.fill : "#cbcbb8",
                }}
              />
            );
          })}
        </div>

        <span className="mono-xs lg-time">
          {currentTime.toFixed(1)}s / {clip.duration_s.toFixed(1)}s
        </span>

        <div className="lg-legend">
          {Object.entries(PAL).map(([k, c]) => (
            <span key={k} className="legend-item">
              <span className="dot" style={{ background: c.fill, borderColor: c.stroke }} />
              <span>{c.kindLabel}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Tweaks panel — toolbar toggle wakes it via __activate_edit_mode. */}
      <TweaksPanel title="Live Graph tweaks">
        <TweakSection label="Animation">
          <TweakSlider
            label="Tied-event stagger"
            value={tweaks.stagger_s} min={0} max={1.5} step={0.05} unit="s"
            onChange={(v) => setTweak("stagger_s", v)}
          />
          <TweakRadio
            label="Active node"
            value={tweaks.active_glow}
            options={[
              { value: "breathing", label: "Breathing" },
              { value: "steady",    label: "Steady" },
              { value: "off",       label: "Off" },
            ]}
            onChange={(v) => setTweak("active_glow", v)}
          />
        </TweakSection>

        <TweakSection label="Canvas">
          <TweakToggle
            label="Dotted grid"
            value={tweaks.show_dots}
            onChange={(v) => setTweak("show_dots", v)}
          />
          <TweakToggle
            label="Phase bands & labels"
            value={tweaks.show_phase_bands}
            onChange={(v) => setTweak("show_phase_bands", v)}
          />
          <TweakToggle
            label="Playhead line"
            value={tweaks.show_playhead}
            onChange={(v) => setTweak("show_playhead", v)}
          />
          <TweakToggle
            label="Edge labels"
            value={tweaks.show_edge_labels}
            onChange={(v) => setTweak("show_edge_labels", v)}
          />
        </TweakSection>

        <TweakSection label="Palette">
          <TweakRadio
            label="Theme"
            value={tweaks.palette}
            options={[
              { value: "neo4j", label: "Neo4j" },
              { value: "warm",  label: "Warm" },
              { value: "mono",  label: "Mono" },
            ]}
            onChange={(v) => setTweak("palette", v)}
          />
        </TweakSection>

        <TweakSection label="Picture-in-picture">
          <TweakButton
            label="Reset PiP position"
            secondary
            onClick={() => {
              try { localStorage.removeItem("lg.pip.state.v1"); } catch {}
              window.location.reload();
            }}
          />
        </TweakSection>
      </TweaksPanel>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="lg-stat">
      <div className="mono-caps">{label}</div>
      <div className="big">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node + Edge sub-components
// ---------------------------------------------------------------------------

const NodeView = React.memo(function NodeView({ node, palette, currentTime, isActive, activeGlow, onJump }) {
  const c = palette[node.kind];
  const revealed = currentTime >= node.revealTime - 0.01;
  const lines = wrapText(node.label, node.kind === "Goal" ? 14 : 13, 3);
  const fontSize = node.kind === "Goal" ? 13 : node.kind === "Clip" ? 13 : 11;
  const glowClass = isActive && revealed
    ? (activeGlow === "breathing" ? " active active-breathing"
      : activeGlow === "steady"    ? " active active-steady"
      : "")
    : "";

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      className="lg-node-pos"
    >
      <g
        className={
          "lg-node" +
          " kind-" + node.kind.toLowerCase() +
          (revealed ? " revealed" : "") +
          glowClass
        }
        style={{ cursor: onJump ? "pointer" : "default", "--glow": c.stroke }}
        onClick={onJump || undefined}
      >
      <circle
        r={c.r}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={isActive && revealed ? 3.5 : 2}
        filter="url(#lg-shadow)"
      />
      <text
        textAnchor="middle"
        fill={c.text}
        style={{
          fontFamily: "Space Grotesk, system-ui, sans-serif",
          fontSize,
          fontWeight: 500,
          pointerEvents: "none",
        }}
      >
        {lines.map((line, i) => {
          const dy = i === 0
            ? `${-(lines.length - 1) * 0.55 + 0.35}em`
            : "1.1em";
          return <tspan key={i} x="0" dy={dy}>{line}</tspan>;
        })}
      </text>
      </g>
    </g>
  );
}, (prev, next) => {
  // Custom comparator: skip re-render unless this node's *visible* state
  // actually flipped. Without this, every onTimeUpdate re-paints all 24
  // nodes, dropping frames during natural playback.
  if (prev.node !== next.node) return false;
  if (prev.palette !== next.palette) return false;
  if (prev.activeGlow !== next.activeGlow) return false;
  if (prev.isActive !== next.isActive) return false;
  if (prev.onJump !== next.onJump) return false;
  const prevRev = prev.currentTime >= prev.node.revealTime - 0.01;
  const nextRev = next.currentTime >= next.node.revealTime - 0.01;
  return prevRev === nextRev;
});

const EdgeView = React.memo(function EdgeView({ edge, layout, currentTime, palette, showLabel }) {
  const from = layout.nodeById.get(edge.from);
  const to = layout.nodeById.get(edge.to);
  if (!from || !to) return null;

  const fromR = palette[from.kind].r;
  const toR = palette[to.kind].r;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const x1 = from.x + ux * fromR;
  const y1 = from.y + uy * fromR;
  const x2 = to.x - ux * toR;
  const y2 = to.y - uy * toR;

  const revealed = currentTime >= edge.revealTime - 0.01;

  // Length used for the stroke draw-in animation. Dashing the edge to its own
  // length and offsetting by the same amount hides it; transitioning offset to
  // 0 "draws" it from parent → child.
  const segLen = Math.hypot(x2 - x1, y2 - y1);

  // Label at midpoint, rotated to align with edge, flipped if upside-down.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;

  return (
    <g className={"lg-edge" + (revealed ? " revealed" : "")}>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="#8b8a7e"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={segLen}
        strokeDashoffset={revealed ? 0 : segLen}
        style={{ transition: "stroke-dashoffset 0.55s ease-out" }}
      />
      {showLabel && (
        <text
          x={mx} y={my - 5}
          textAnchor="middle"
          transform={`rotate(${angle}, ${mx}, ${my - 5})`}
          fill="#7a786c"
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 9,
            letterSpacing: "0.05em",
            pointerEvents: "none",
          }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}, (prev, next) => {
  if (prev.edge !== next.edge) return false;
  if (prev.layout !== next.layout) return false;
  if (prev.palette !== next.palette) return false;
  if (prev.showLabel !== next.showLabel) return false;
  const prevRev = prev.currentTime >= prev.edge.revealTime - 0.01;
  const nextRev = next.currentTime >= next.edge.revealTime - 0.01;
  return prevRev === nextRev;
});

// ---------------------------------------------------------------------------
// Layout — tiered tree positions.
// ---------------------------------------------------------------------------

function computeLayout(graph, W, H, palette, staggerSeconds) {
  const clip = graph.clip;
  const events = graph.eventsInOrder();
  const allPhases = graph.phasesInOrder();
  const phases = allPhases.filter((p) =>
    events.some((e) => e.props.phase_key === p.props.phase_key)
  );

  // Unique components by name; multiple events may share one (install/remove/re-install).
  const compMap = new Map();
  events.forEach((e) => {
    const name = e.props.component_name;
    if (!compMap.has(name)) compMap.set(name, { name, events: [] });
    compMap.get(name).events.push(e);
  });
  const components = [...compMap.values()];

  const margin = 90;
  const innerW = W - 2 * margin;

  const yRow = {
    Clip:      60,
    Goal:      180,
    Phase:     330,
    Event:     490,
    Component: 650,
  };

  const nodes = [];
  const nodeById = new Map();
  const add = (n) => { nodes.push(n); nodeById.set(n.id, n); };

  const clipId = "clip::" + clip.id;
  const goalId = "goal::" + clip.id;

  // Clip
  add({
    id: clipId, kind: "Clip", label: clip.id,
    x: W / 2, y: yRow.Clip, revealTime: 0,
  });

  // Goal — wrap nicely.
  add({
    id: goalId, kind: "Goal",
    label: "Reach final CAD assembly",
    x: W / 2, y: yRow.Goal, revealTime: 0,
  });

  // Phases — evenly distributed, full width.
  const phaseSlotW = innerW / Math.max(1, phases.length);
  const phaseSlot = {};
  phases.forEach((p, i) => {
    const x = margin + phaseSlotW * (i + 0.5);
    phaseSlot[p.props.phase_key] = { x, start: margin + phaseSlotW * i, width: phaseSlotW };
    add({
      id: p.id, kind: "Phase",
      label: p.label,
      x, y: yRow.Phase, revealTime: 0,
      phaseKey: p.props.phase_key,
    });
  });

  // Compute staggered reveal times. Events that fire at the same time_s
  // get pushed back by `staggerSeconds * tie-index` so they cascade in one at
  // a time. The data is unchanged — this is purely visual choreography.
  const TIE_STAGGER_S = staggerSeconds ?? 0.45;
  const eventReveal = new Map();
  // group events by their original time_s, preserving canonical order
  const tieGroups = new Map();
  events.forEach((e) => {
    const t = e.props.time_s.toFixed(2);
    if (!tieGroups.has(t)) tieGroups.set(t, []);
    tieGroups.get(t).push(e);
  });
  for (const group of tieGroups.values()) {
    group.forEach((e, i) => {
      eventReveal.set(e.id, e.props.time_s + i * TIE_STAGGER_S);
    });
  }

  // Events grouped under their phase, in local order.
  const eventsByPhase = new Map();
  events.forEach((e) => {
    const k = e.props.phase_key;
    if (!eventsByPhase.has(k)) eventsByPhase.set(k, []);
    eventsByPhase.get(k).push(e);
  });

  const eventX = {};
  events.forEach((e) => {
    const k = e.props.phase_key;
    const peers = eventsByPhase.get(k);
    const localIdx = peers.findIndex((x) => x.id === e.id);
    const slot = phaseSlot[k];
    const subW = slot.width / peers.length;
    const x = slot.start + subW * (localIdx + 0.5);
    eventX[e.id] = x;
    add({
      id: e.id, kind: "Event",
      label: shortenStepLabel(e.label),
      x, y: yRow.Event, revealTime: eventReveal.get(e.id),
      stepId: e.props.step_id,
    });
  });

  // Components — sorted by first appearance, evenly distributed across width.
  // Each component reveals when the FIRST event that touches it reveals
  // (using the staggered time), so components also cascade in nicely.
  const sortedComps = [...components].sort(
    (a, b) => eventReveal.get(a.events[0].id) - eventReveal.get(b.events[0].id)
  );
  const compSlotW = innerW / Math.max(1, sortedComps.length);
  const compIdFor = (name) => "comp::" + name.replace(/\s+/g, "_");
  sortedComps.forEach((c, i) => {
    const x = margin + compSlotW * (i + 0.5);
    add({
      id: compIdFor(c.name), kind: "Component",
      label: c.name,
      x, y: yRow.Component,
      revealTime: eventReveal.get(c.events[0].id),
    });
  });

  // Edges — phase scaffold reveals at time 0; per-event edges (HAS_STEP /
  // ACTS_ON) follow the staggered event reveal so they draw in *with* the
  // node, not before.
  const edges = [];
  edges.push({ from: clipId, to: goalId, label: "HAS_GOAL", revealTime: 0 });
  phases.forEach((p) => {
    edges.push({ from: goalId, to: p.id, label: "HAS_PHASE", revealTime: 0 });
  });
  events.forEach((e) => {
    const phaseNode = phases.find((p) => p.props.phase_key === e.props.phase_key);
    if (phaseNode) {
      edges.push({ from: phaseNode.id, to: e.id, label: "HAS_STEP", revealTime: eventReveal.get(e.id) });
    }
    edges.push({
      from: e.id,
      to: compIdFor(e.props.component_name),
      label: "ACTS_ON",
      revealTime: eventReveal.get(e.id),
    });
  });

  // Phase bands — metadata for the rendered phase columns (background tint
  // + axis label). Computed here so we don't recompute layout coords in the
  // render path on every progress tick.
  const phaseBands = phases.map((p) => {
    const slot = phaseSlot[p.props.phase_key];
    return { x: slot.start, w: slot.width, label: p.label };
  });

  return { nodes, nodeById, edges, eventReveal, phaseBands, visiblePhases: phases.length, W, H };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapText(text, maxChars, maxLines) {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = (cur + " " + w).trim();
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const trimmed = lines.slice(0, maxLines);
    trimmed[maxLines - 1] = trimmed[maxLines - 1].slice(0, maxChars - 1) + "…";
    return trimmed;
  }
  return lines;
}

function shortenStepLabel(label) {
  // "Install front rear chassis" stays — already terse.
  // Strip leading verb redundancy if the label gets long.
  if (label.length <= 22) return label;
  return label;
}

// ---------------------------------------------------------------------------
// Video PiP — draggable + resizable picture-in-picture
// ---------------------------------------------------------------------------
//
// State: { x, y, w } in pixels, relative to the canvas-wrap. Height derives
// from width via a fixed 16:9 aspect (matches the screen contents); the
// caption strip below is fixed-height (~52px) and rides along.
//
// Default position: bottom-right with a 24px inset. Persisted to localStorage
// so the presenter's arrangement survives reloads.

const PIP_STORE_KEY = "lg.pip.state.v1";
const PIP_DEFAULT_W = 300;
const PIP_MIN_W = 180;
const PIP_MAX_W = 720;
const PIP_ASPECT = 16 / 9;
const PIP_CAPTION_H = 52;

function readPipState() {
  try {
    const raw = localStorage.getItem(PIP_STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === "number" && typeof p?.y === "number" && typeof p?.w === "number") {
      return p;
    }
  } catch {}
  return null;
}

function VideoPiP({ clipId, videoUrl, videoRef, fileRef, onFile, activeEvent }) {
  const wrapRef = useRef(null);
  const [pip, setPip] = useState(() => readPipState() || { x: null, y: null, w: PIP_DEFAULT_W });

  // On mount, if no stored position, place the PiP at bottom-right of canvas.
  useEffect(() => {
    if (pip.x != null && pip.y != null) return;
    const parent = wrapRef.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const w = pip.w;
    const h = w / PIP_ASPECT + PIP_CAPTION_H;
    setPip((p) => ({ ...p, x: rect.width - w - 24, y: rect.height - h - 24 }));
  }, []); // eslint-disable-line

  // Persist whenever it changes (only once positioned).
  useEffect(() => {
    if (pip.x == null || pip.y == null) return;
    try { localStorage.setItem(PIP_STORE_KEY, JSON.stringify(pip)); } catch {}
  }, [pip]);

  // Clamp to parent bounds (called from drag/resize handlers).
  function clampToParent(next) {
    const parent = wrapRef.current?.parentElement;
    if (!parent) return next;
    const rect = parent.getBoundingClientRect();
    const w = next.w;
    const h = w / PIP_ASPECT + PIP_CAPTION_H;
    const x = Math.max(0, Math.min(rect.width - w, next.x));
    const y = Math.max(0, Math.min(rect.height - h, next.y));
    return { ...next, x, y };
  }

  // ---------- Drag from the top bar ----------
  function startDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...pip };
    function onMove(ev) {
      const next = clampToParent({
        ...start,
        x: (start.x ?? 0) + (ev.clientX - startX),
        y: (start.y ?? 0) + (ev.clientY - startY),
      });
      setPip(next);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
  }

  // ---------- Resize from the bottom-right corner ----------
  function startResize(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = { ...pip };
    function onMove(ev) {
      const dx = ev.clientX - startX;
      const w = Math.max(PIP_MIN_W, Math.min(PIP_MAX_W, start.w + dx));
      setPip(clampToParent({ ...start, w }));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";
  }

  const h = pip.w / PIP_ASPECT + PIP_CAPTION_H;
  const style = pip.x == null ? { visibility: "hidden" } : {
    left: pip.x, top: pip.y, width: pip.w, height: h,
  };

  return (
    <div ref={wrapRef} className="lg-pip" style={style}>
      <div className="lg-pip-dragbar" onMouseDown={startDrag} title="Drag to move">
        <div className="lg-pip-rec">● REC · {clipId}</div>
        <div className="lg-pip-grip" aria-hidden="true">
          <span /><span /><span />
        </div>
      </div>

      <div className="lg-pip-screen">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            muted
            playsInline
          />
        ) : (
          <div className="lg-pip-empty">
            <div className="mono-caps" style={{ color: "#c8c6b8" }}>no video</div>
            <div style={{ fontSize: 11, color: "#9c9b8d", marginTop: 4, textAlign: "center" }}>
              Press <strong>play</strong> to simulate,<br />or load a clip:
            </div>
            <label className="lg-pip-load">
              <span>Load video</span>
              <input ref={fileRef} type="file" accept="video/*" onChange={onFile} style={{ display: "none" }} />
            </label>
          </div>
        )}
      </div>

      <div className="lg-pip-caption">
        {activeEvent ? (
          <>
            <div className="title">{activeEvent.label}</div>
            <div className="mono-xs">
              frame {activeEvent.props.frame} · {activeEvent.props.time_s.toFixed(1)}s
            </div>
          </>
        ) : (
          <div className="mono-xs" style={{ color: "#7a786c" }}>
            waiting for first step…
          </div>
        )}
      </div>

      <div
        className="lg-pip-resize"
        onMouseDown={startResize}
        title="Drag to resize"
        aria-label="Resize"
      />
    </div>
  );
}

Object.assign(window, { LiveGraphView });
