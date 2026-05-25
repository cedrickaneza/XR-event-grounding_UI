// components.jsx — UI components for the XR Event Grounding platform.
// Pure presentational + small interactions. Real logic lives in
// graph-store / retriever / providers / app.

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// ---------------------------------------------------------------------------
// Inline icons (Lucide-style, 1.5px stroke).
// ---------------------------------------------------------------------------
function Icon({ name, size = 16 }) {
  const s = size;
  const stroke = "currentColor";
  const sw = 1.6;
  const common = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "play":  return <svg {...common}><polygon points="6 4 20 12 6 20 6 4" fill={stroke} stroke="none" /></svg>;
    case "pause": return <svg {...common}><rect x="6" y="4" width="4" height="16" fill={stroke} stroke="none" /><rect x="14" y="4" width="4" height="16" fill={stroke} stroke="none" /></svg>;
    case "prev":  return <svg {...common}><polygon points="19 20 9 12 19 4 19 20" fill={stroke} stroke="none" /><line x1="5" y1="5" x2="5" y2="19" /></svg>;
    case "next":  return <svg {...common}><polygon points="5 4 15 12 5 20 5 4" fill={stroke} stroke="none" /><line x1="19" y1="5" x2="19" y2="19" /></svg>;
    case "send":  return <svg {...common}><path d="M22 2L11 13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>;
    case "mic":   return <svg {...common}><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="22" /></svg>;
    case "stop":  return <svg {...common}><rect x="6" y="6" width="12" height="12" rx="1.5" fill={stroke} stroke="none" /></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
    case "close": return <svg {...common}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
    case "graph": return <svg {...common}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><line x1="6" y1="8" x2="6" y2="16" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="18" y1="8" x2="18" y2="16" /><line x1="8" y1="18" x2="16" y2="18" /></svg>;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------
function Topbar({ tab, onTab, clipId, onOpenProviders, aiOn, onAiToggle, ttsEnabled, onTtsToggle, llmLabel, voiceLabel }) {
  return (
    <header className="topbar">
      <div className="wm">
        <div className="wm-mark" />
        <h4>XR Event Grounding</h4>
      </div>
      <div className="tabs">
        <div className={"tab" + (tab === "instruction" ? " active" : "")}
             onClick={() => onTab("instruction")}>Instruction</div>
        <div className={"tab" + (tab === "config" ? " active" : "")}
             onClick={() => onTab("config")}>AI Configuration</div>
      </div>
      <div className="spacer" />
      <div className="meta">
        <span className="pill" title="Active clip">clip · {clipId}</span>
        <span className="pill" onClick={onOpenProviders} title={"LLM · " + llmLabel} style={{ cursor: "pointer" }}>
          LLM · {llmLabel}
        </span>
        <span className="pill" onClick={onOpenProviders} title={"Voice · " + voiceLabel} style={{ cursor: "pointer" }}>
          voice · {voiceLabel}
        </span>
        <div className="pair">
          <span className="mono-caps">Voice</span>
          <div className={"toggle" + (ttsEnabled ? " on" : "")} onClick={onTtsToggle} title={ttsEnabled ? "Mute AI voice" : "Unmute AI voice"}>
            <div className="dot" />
          </div>
        </div>
        <div className="pair">
          <span className="mono-caps">AI Agent</span>
          <div className={"toggle" + (aiOn ? " on" : "")} onClick={onAiToggle}>
            <div className="dot" />
          </div>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Steps panel
// ---------------------------------------------------------------------------
function StepsPanel({ graph, activeEventId, onPickStep }) {
  const phases = graph.phasesInOrder();
  const events = graph.eventsInOrder();
  const byPhase = useMemo(() => {
    const m = new Map();
    events.forEach((e) => {
      const k = e.props.phase_key;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    });
    return m;
  }, [events]);

  // Phases that actually contain events from this clip — skip the empty ones
  // (e.g. "Initial setup" in 03_assy_0_1 has no observed steps).
  const visiblePhases = phases.filter((p) => (byPhase.get(p.props.phase_key) || []).length > 0);
  // Renumber visible phases 1..N so the user sees "phase 1/4" not "phase 2/6"
  // (the original 6 includes empty Initial-setup and Correction-handling
  // phases which we hide).
  const visibleByKey = new Map(visiblePhases.map((p, i) => [p.props.phase_key, i + 1]));

  const activeIdx = events.findIndex((e) => e.id === activeEventId);

  return (
    <section className="steps">
      <div className="panel-head">
        <h3>Steps</h3>
        <span className="mono-caps">{events.length} · {visiblePhases.length} phases</span>
      </div>
      <div className="steps-list">
        {visiblePhases.map((p) => (
          <div className="phase" key={p.id}>
            <div className="phase-head">
              <span className="mono-caps">phase {visibleByKey.get(p.props.phase_key)} / {visiblePhases.length}</span>
              <div className="rule" />
            </div>
            <h4 className="fg-1" style={{ padding: "0 8px", marginBottom: 0, lineHeight: 1.3 }}>{p.label}</h4>
            <div className="flex-col gap-2" style={{ marginTop: 6 }}>
              {(byPhase.get(p.props.phase_key) || []).map((e, i) => {
                const idx = events.findIndex((x) => x.id === e.id);
                const isActive = e.id === activeEventId;
                const isDone = idx < activeIdx;
                return (
                  <div
                    key={e.id}
                    className={"step" + (isActive ? " active" : isDone ? " done" : "")}
                    onClick={() => onPickStep(e.id)}
                  >
                    <span className="num">{String(idx + 1).padStart(2, "0")}</span>
                    <div className="body">
                      <div className="desc">{e.label}</div>
                      <div className="meta">
                        <span className="ml">acts_on · {e.props.component_name}</span>
                      </div>
                    </div>
                    <span className="t">{e.props.time_s.toFixed(1)}s</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Video panel
// ---------------------------------------------------------------------------
function VideoPanel({ graph, activeEventId, progress, onScrub, playing, onTogglePlay, onJumpEvent }) {
  const events = graph.eventsInOrder();
  const active = graph.get(activeEventId);
  const clip = graph.clip;
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState(null);

  // Keep <video> in sync with our shared progress state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    const dur = v.duration || clip.duration_s;
    if (!isFinite(dur)) return;
    const target = progress * dur;
    if (Math.abs(v.currentTime - target) > 0.4) v.currentTime = target;
    if (playing) v.play().catch(() => {}); else v.pause();
  }, [progress, playing, videoUrl, clip.duration_s]);

  function onFile(e) {
    const f = e.target.files?.[0];
    if (f) setVideoUrl(URL.createObjectURL(f));
  }
  function onTimeUpdate(e) {
    const v = e.target;
    if (!v.duration) return;
    onScrub(v.currentTime / v.duration);
  }

  return (
    <section className="video-col">
      <div className="hd">
        <div className="row">
          <div>
            <span className="mono-caps">IndustReal · raw_cad pilot</span>
            <h2 className="mt-1">Clip {clip.id}</h2>
            <div className="mono-xs mt-2 fg-3">
              {clip.n_frames} frames · {clip.duration_s.toFixed(1)} s · f1 = {clip.metrics?.f1?.toFixed(2) ?? "—"}
            </div>
          </div>
          <div className="flex gap-2">
            <label className="btn">
              <span className="mono-caps" style={{ letterSpacing: "0.08em" }}>Load video</span>
              <input ref={fileRef} type="file" accept="video/*" onChange={onFile} style={{ display: "none" }} />
            </label>
          </div>
        </div>
      </div>

      <div className="stage-wrap">
        <div className="stage-overlay-tl">● REC · {clip.id}</div>
        {videoUrl ? (
          <video ref={videoRef} src={videoUrl} onTimeUpdate={onTimeUpdate} muted playsInline />
        ) : (
          <div className="stage-placeholder">
            <div style={{ textAlign: "center" }}>
              <div className="mono-caps">no clip loaded</div>
              <div className="mt-2 fg-3" style={{ fontSize: 13 }}>
                Drop in any reference video — controls are simulated against the timeline.
              </div>
            </div>
          </div>
        )}
        {active && (
          <div className="caption">
            {active.label} <span className="mono-xs fg-3">· frame {active.props.frame} · {active.props.time_s.toFixed(1)} s</span>
          </div>
        )}
      </div>

      <div className="flex-col" style={{ padding: "0 var(--s5)" }}>
        <div
          className="scrubber"
          style={{ marginTop: 16 }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            onScrub(p);
            // Snap to the nearest event timestamp for keyboard-style navigation.
            const targetT = p * clip.duration_s;
            let best = events[0]; let bestD = Infinity;
            events.forEach((ev) => {
              const d = Math.abs(ev.props.time_s - targetT);
              if (d < bestD) { bestD = d; best = ev; }
            });
            if (best && bestD < 6) onJumpEvent(best.id);
          }}
        >
          <div className="fill" style={{ width: `${progress * 100}%` }} />
          <div className="knob" style={{ left: `${progress * 100}%` }} />
          {events.map((ev) => (
            <div
              key={ev.id}
              title={ev.label + " · " + ev.props.time_s.toFixed(1) + "s"}
              style={{
                position: "absolute", top: -2, bottom: -2,
                left: `${(ev.props.time_s / clip.duration_s) * 100}%`,
                width: 2, marginLeft: -1,
                background: ev.id === activeEventId ? "var(--accent-300)" : "var(--border-3)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="controls">
        <div className="flex gap-2 ai-center">
          <span className="mono-xs fg-3">{(progress * clip.duration_s).toFixed(1)}s / {clip.duration_s.toFixed(1)}s</span>
        </div>
        <div className="transport">
          <button className="btn icon" title="Previous step" onClick={() => {
            const cur = events.findIndex((e) => e.id === activeEventId);
            if (cur > 0) onJumpEvent(events[cur - 1].id);
          }}><Icon name="prev" /></button>
          <button className="btn primary play-big" onClick={onTogglePlay} title={playing ? "Pause" : "Play"}>
            <Icon name={playing ? "pause" : "play"} size={20} />
          </button>
          <button className="btn icon" title="Next step" onClick={() => {
            const cur = events.findIndex((e) => e.id === activeEventId);
            if (cur >= 0 && cur < events.length - 1) onJumpEvent(events[cur + 1].id);
          }}><Icon name="next" /></button>
        </div>
        <div className="flex gap-2 ai-center" style={{ justifyContent: "flex-end" }}>
          <span className="mono-xs fg-3" style={{ whiteSpace: "nowrap" }}>step {events.findIndex((e) => e.id === activeEventId) + 1}&thinsp;/&thinsp;{events.length}</span>
        </div>
      </div>

      {active && (
        <div className="step-card">
          <div>
            <span className="mono-caps">step · {active.props.phase_key.replace(/_/g, " ")}</span>
            <h3 className="mt-1">{active.label}</h3>
            <div className="fg-2 mt-2" style={{ fontSize: 14 }}>
              Frame {active.props.frame} · timecode {active.props.time_s.toFixed(1)}s · confidence{" "}
              <span className="mono">{(active.props.conf * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div className="target">
            <span className="mono-caps">acts_on</span>
            <div className="fg-accent mt-1">{active.props.component_name.replace(/ /g, "_")}</div>
            <div className="mt-3">
              <span className="mono-caps">CAD target</span>
              <div className="fg-2 mt-1">state_{clip.goal.target_state_index} · {clip.goal.target_state_name}</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chat panel
// ---------------------------------------------------------------------------
function ChatPanel({
  aiOn, messages, busy, onSend, onShowGraph, onCancel,
  voiceMode, sttListening, onPttDown, onPttUp,
  llmLabel, voiceLabel, clipId,
}) {
  const [text, setText] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  if (!aiOn) {
    return (
      <section className="chat">
        <div className="chat-head">
          <div className="left">
            <span className="dot" style={{ background: "var(--fg-4)" }} />
            <span className="name fg-3">Grounding Agent · off</span>
          </div>
        </div>
        <div className="chat-scroll" style={{ alignItems: "center", justifyContent: "center" }}>
          <div className="fg-3" style={{ fontSize: 14, maxWidth: 260, textAlign: "center", margin: "auto" }}>
            Toggle the AI Agent on (top-right) to ask grounded questions about this assembly.
          </div>
        </div>
      </section>
    );
  }

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  }

  return (
    <section className="chat">
      <div className="chat-head">
        <div className="left">
          <span className="dot" />
          <span className="name">Grounding Agent</span>
          <span className="mono-caps" style={{ marginLeft: 8 }}>{llmLabel}</span>
        </div>
        <div className="meta">graph-only · {voiceLabel}</div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="bubble ai">
            <div className="who">
              <span className="badge">Grounding agent</span>
              <span className="time">ready</span>
            </div>
            Ask me anything about clip <code>{clipId}</code>. I'll answer only from the assembly graph and cite the nodes I used.
            <div className="trail">
              <div className="trail-row">
                <span className="mono-caps" style={{ color: "var(--fg-3)" }}>Try</span>
                <span className="chip"><span className="kind">ask</span><span>Why are steps 1, 2, 3 simultaneous?</span></span>
                <span className="chip"><span className="kind">ask</span><span>What's left to install?</span></span>
              </div>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <Message key={i} msg={m} onShowGraph={onShowGraph} />
        ))}

        {busy && (
          <div className="bubble ai thinking">
            <div className="who">
              <span className="badge">Grounding agent</span>
              <span className="time">walking the graph…</span>
            </div>
            Querying subgraph and prompting model…
          </div>
        )}
      </div>

      <div className="composer">
        <input
          placeholder="Ask the graph a question…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={busy}
        />
        <button className="btn icon" onClick={submit} disabled={busy || !text.trim()} title="Send"><Icon name="send" /></button>
        <button
          className={"ptt" + (sttListening ? " recording" : "")}
          onMouseDown={onPttDown}
          onMouseUp={onPttUp}
          onMouseLeave={(e) => sttListening && onPttUp(e)}
          onTouchStart={onPttDown}
          onTouchEnd={onPttUp}
          title={voiceMode === "always-on" ? "Always-on (tap to start)" : "Hold to talk"}
        >
          <Icon name={sttListening ? "stop" : "mic"} size={18} />
        </button>
      </div>
    </section>
  );
}

function Message({ msg, onShowGraph }) {
  if (msg.role === "user") {
    return (
      <div className="bubble you">
        <div className="who">
          <span className="badge" style={{ color: "var(--fg-2)", borderColor: "var(--border-2)" }}>You</span>
          <span className="time">{msg.time}</span>
        </div>
        {msg.text}
      </div>
    );
  }
  return (
    <div className="bubble ai">
      <div className="who">
        <span className="badge">Grounding agent</span>
        <span className="time">{msg.time}</span>
      </div>
      <AnswerText text={msg.text} refs={msg.refs || []} />
      {msg.refs && msg.refs.length > 0 && (
        <div className="trail">
          <div className="flex jc-between ai-center" style={{ marginBottom: 6 }}>
            <span className="mono-caps">Retrieval · {msg.refs.length} nodes</span>
            <button className="btn compact ghost" onClick={() => onShowGraph(msg.subgraph)}>Show graph trail →</button>
          </div>
          <div className="trail-row">
            {msg.refs.slice(0, 12).map((r) => (
              <span key={r.short} className="chip active" title={r.node.label}>
                <span className="kind">{r.node.kind}</span>
                <span>{r.short} · {truncate(r.node.label, 22)}</span>
              </span>
            ))}
          </div>
          <div className="confidence-bar mt-2">
            <span>conf</span>
            <div className="bar"><div className="fill" style={{ width: `${(msg.confidence ?? 0.9) * 100}%` }} /></div>
            <span>{((msg.confidence ?? 0.9) * 100).toFixed(0)}%</span>
            <span style={{ marginLeft: 8 }}>· source: assembly_graph.json</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Highlight inline [eN] / [pN] / etc. citations.
function AnswerText({ text, refs }) {
  const refSet = new Set(refs.map((r) => r.short));
  const parts = text.split(/(\[[a-z]\d+\])/g);
  return (
    <span>
      {parts.map((part, i) => {
        const m = part.match(/^\[([a-z])(\d+)\]$/);
        if (m && refSet.has(m[1] + m[2])) {
          return <code key={i} style={{ color: "var(--accent-300)", marginLeft: 1, marginRight: 1 }}>{part}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ---------------------------------------------------------------------------
// Provider drawer (open-architecture switcher)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Conversational agent floating button
// ---------------------------------------------------------------------------
function ConvAgentButton({ agentId, apiKey, tools, dynamicVars, onTranscript, onAgentText }) {
  const [status, setStatus] = React.useState('idle');
  const [mode,   setMode]   = React.useState(null);
  const [errMsg, setErrMsg] = React.useState('');

  const isActive = status === 'connected' || status === 'connecting';

  async function handleClick() {
    if (isActive || status === 'error') {
      window.ConvAgent.stop();
      setStatus('idle');
      setMode(null);
      setErrMsg('');
    } else {
      setErrMsg('');
      await window.ConvAgent.start(agentId, apiKey, {
        onStatus: setStatus,
        onMode:   setMode,
        onTranscript,
        onAgentText,
        onError:  setErrMsg,
        tools,
        dynamicVars,
      });
    }
  }

  const orbState =
    status === 'error'      ? 'error'      :
    status === 'connecting' ? 'connecting' :
    mode   === 'speaking'   ? 'speaking'   :
    mode   === 'thinking'   ? 'thinking'   :
    mode   === 'listening'  ? 'listening'  : 'idle';

  const label =
    status === 'connecting' ? 'Connecting…'          :
    status === 'error'      ? 'Error — tap to close' :
    mode   === 'thinking'   ? 'Thinking…'            :
    mode   === 'speaking'   ? 'Speaking…'            :
    mode   === 'listening'  ? 'Listening…'           :
    isActive                ? 'Connected'            : 'Talk to an agent';

  return (
    <button
      className={'conv-agent-btn' + (isActive ? ' active' : '') + (status === 'error' ? ' err' : '')}
      onClick={handleClick}
      title={errMsg || label}
    >
      <div className={'conv-orb ' + orbState} />
      <span>{label}</span>
      {isActive && (
        <svg className="x-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6"  y1="6" x2="18" y2="18" />
        </svg>
      )}
    </button>
  );
}

function ConvAgentDrawerGroup({ convAgentId, onConvAgentId, voiceKey }) {
  const [state, setState] = React.useState("idle"); // idle | working | ok | err
  const [msg,   setMsg]   = React.useState("");

  async function configure() {
    if (!convAgentId.trim()) { setMsg("Enter an Agent ID first."); setState("err"); return; }
    if (!voiceKey.trim())    { setMsg("Set your ElevenLabs API key above first."); setState("err"); return; }
    setState("working"); setMsg("");
    try {
      const r = await window.ConvAgent.configureAgent(convAgentId.trim(), voiceKey.trim());
      if (r.alreadyConfigured) {
        setMsg("Already configured.");
      } else {
        const parts = [];
        if (r.toolsAdded?.length) parts.push("Tools added");
        if (r.promptUpdated)      parts.push("Prompt updated");
        setMsg(parts.join(" · ") + " ✓");
      }
      setState("ok");
    } catch (e) {
      setMsg(e.message);
      setState("err");
    }
  }

  return (
    <div className="group">
      <div className="label">Conversational Agent</div>
      <div className="mono-xs fg-3" style={{ marginBottom: 8 }}>
        Enter your ElevenLabs Agent ID, then click Auto-configure to add navigation tools automatically.
      </div>
      <div className="field">
        <div className="label">Agent ID</div>
        <input
          value={convAgentId}
          onChange={(e) => { onConvAgentId(e.target.value); setState("idle"); setMsg(""); }}
          placeholder="agt_•••"
        />
      </div>
      <div className="flex gap-2" style={{ marginTop: 8, alignItems: "center" }}>
        <button
          className={"btn" + (state === "ok" ? " primary" : "")}
          onClick={configure}
          disabled={state === "working"}
          style={{ flexShrink: 0 }}
        >
          {state === "working" ? "Configuring…" : state === "ok" ? "✓ Done" : "Auto-configure"}
        </button>
        {msg && (
          <span className="mono-xs" style={{ color: state === "err" ? "var(--fail)" : "var(--ok)", flex: 1 }}>
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}

function ProviderDrawer({ open, onClose, llmId, onLlm, voiceId, onVoice, voiceMode, onVoiceMode, llmKey, onLlmKey, voiceKey, onVoiceKey, llmEndpoint, onLlmEndpoint, convAgentId, onConvAgentId }) {
  if (!open) return null;
  const llms = window.Providers.LLM.list();
  const voices = window.Providers.TTS.list();
  const llm = llms.find((p) => p.id === llmId) || llms[0];

  return (
    <React.Fragment>
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <span className="mono-caps">Settings</span>
            <h3 className="mt-1">AI Configuration</h3>
          </div>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          <div className="group">
            <div className="label">LLM provider</div>
            {llms.map((p) => (
              <div key={p.id} className={"row" + (p.id === llmId ? " active" : "")} onClick={() => onLlm(p.id)}>
                <div className="dot" />
                <div>
                  <div className="name">{p.label}</div>
                  <div className="ep">{p.endpoint}</div>
                </div>
                <span className={"pill " + (p.kind === "local" ? "local" : p.kind === "builtin" ? "builtin" : "")}>
                  {p.kind}
                </span>
              </div>
            ))}
            <div className="field">
              <div className="label">Endpoint URL</div>
              <input value={llmEndpoint} onChange={(e) => onLlmEndpoint(e.target.value)} placeholder={llm.endpoint} />
            </div>
            {llm.needsKey && (
              <div className="field">
                <div className="label">API key</div>
                <input type="password" value={llmKey} onChange={(e) => onLlmKey(e.target.value)} placeholder="sk-•••" />
              </div>
            )}
          </div>

          <div className="group">
            <div className="label">Voice provider</div>
            {voices.map((p) => (
              <div key={p.id} className={"row" + (p.id === voiceId ? " active" : "")} onClick={() => onVoice(p.id)}>
                <div className="dot" />
                <div>
                  <div className="name">{p.label}</div>
                  <div className="ep">{p.endpoint}</div>
                </div>
                <span className={"pill " + (p.kind === "local" ? "local" : "")}>{p.kind}</span>
              </div>
            ))}
            {voices.find((v) => v.id === voiceId)?.needsKey && (
              <div className="field">
                <div className="label">API key</div>
                <input type="password" value={voiceKey} onChange={(e) => onVoiceKey(e.target.value)} placeholder="eleven-•••" />
              </div>
            )}
          </div>

          <div className="group">
            <div className="label">Voice mode</div>
            <div className="flex gap-2">
              {["push-to-talk", "always-on"].map((m) => (
                <button
                  key={m}
                  className={"btn " + (voiceMode === m ? "primary" : "")}
                  onClick={() => onVoiceMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="mono-xs fg-3">
              Push-to-talk: hold the mic. Always-on: tap to start a listening session.
            </div>
          </div>

          <ConvAgentDrawerGroup
            convAgentId={convAgentId}
            onConvAgentId={onConvAgentId}
            voiceKey={voiceKey}
          />
        </div>
      </aside>
    </React.Fragment>
  );
}

Object.assign(window, {
  Topbar, StepsPanel, VideoPanel, ChatPanel, Message, ProviderDrawer, ConvAgentButton, Icon,
});
