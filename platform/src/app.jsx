// app.jsx — root.
// Wires graph store + retriever + providers + UI components together.
//
// State model:
//   clipId         — which clip we're working with
//   activeEventId  — the current step (used to seed retrieval)
//   progress       — 0..1 video position (synced from / to <video>)
//   messages       — chat history
//   busy           — true while a query is in flight
//   providers      — selected LLM/voice ids + keys + endpoints + voice mode
//   subgraph (for overlay) — the last subgraph the model saw
//
// The chat send is the meaty path:
//   1. retrieve subgraph from active event + question
//   2. serialize for the LLM
//   3. ask the active LLM provider
//   4. parse [eN] citations out of the answer to highlight them
//   5. speak the answer through the active voice provider

const { useEffect, useMemo, useRef, useState } = React;
const {
  Topbar, StepsPanel, VideoPanel, ChatPanel, ProviderDrawer,
  GraphViz, GraphOverlay,
} = window;

function App() {
  // ---------- Top-level state ----------
  const [tab, setTab] = useState("instruction");
  const [clipId, setClipId] = useState(window.INDUSTREAL_DATA.default_clip);
  const graph = useMemo(() => window.GraphStore.build(clipId), [clipId]);

  const firstEventId = useMemo(() => graph.eventsInOrder()[0]?.id ?? null, [graph]);
  const [activeEventId, setActiveEventId] = useState(firstEventId);
  useEffect(() => {
    // when clip switches, snap to first event
    setActiveEventId(graph.eventsInOrder()[0]?.id ?? null);
  }, [clipId]);

  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Sync progress when the active event changes via keyboard / list click.
  useEffect(() => {
    const e = graph.get(activeEventId);
    if (e) setProgress(Math.min(0.99, e.props.time_s / graph.clip.duration_s));
  }, [activeEventId]);

  // ---------- Providers ----------
  // Use built-in if available (Claude Design sandbox), otherwise stay on it
  // and let the graceful error message guide users to configure a real provider.
  const [llmId, setLlmId] = useState("claude-builtin");
  const [voiceId, setVoiceId] = useState("browser-tts");
  const [voiceMode, setVoiceMode] = useState("push-to-talk");
  const [llmKey, setLlmKey] = useState("");
  const [voiceKey, setVoiceKey] = useState("");
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [aiOn, setAiOn] = useState(true);

  const llm = window.Providers.LLM.find(llmId);
  const voice = window.Providers.TTS.find(voiceId);

  // ---------- Chat ----------
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState(null);
  const ttsAbortRef = useRef(null);

  // ---------- STT ----------
  const [sttListening, setSttListening] = useState(false);
  const sttStopRef = useRef(null);
  const sttTextRef = useRef("");

  function nowTime() {
    const d = new Date();
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  async function handleSend(text) {
    if (!text.trim()) return;
    const userMsg = { role: "user", text, time: nowTime() };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);

    try {
      // Retrieve
      const subgraph = window.Retriever.retrieve(graph, text, activeEventId, { depth: 2, topK: 14 });
      const serialized = window.Retriever.serialize(subgraph);

      const activeEv = graph.get(activeEventId);
      const activeLine = activeEv
        ? `[${serialized.activeRef}] step "${activeEv.label}" at frame ${activeEv.props.frame} (${activeEv.props.time_s.toFixed(1)}s) acting on "${activeEv.props.component_name}"`
        : "(no active step)";

      const systemPrompt = window.Prompts.build({
        clipId,
        activeStepLine: activeLine,
        subgraphText: serialized.text,
        question: text,
      });

      // LLM
      const answer = await window.Providers.LLM.complete({
        providerId: llmId,
        systemPrompt,
        userMessage: text,
        key: llmKey,
        endpoint: llmEndpoint || llm?.endpoint,
      });

      // Parse cited short ids from the answer text and elevate them.
      const cited = new Set();
      (answer.match(/\[[a-z]\d+\]/g) || []).forEach((m) => cited.add(m.slice(1, -1)));
      const refsUsed = serialized.refs.filter((r) => cited.has(r.short));
      // Always include the seeds in the displayed trail so the user can see
      // what was given to the model, even if no inline citation was made.
      const seenShort = new Set(refsUsed.map((r) => r.short));
      serialized.refs.slice(0, 8).forEach((r) => {
        if (!seenShort.has(r.short) && subgraph.seeds.includes(r.node.id)) refsUsed.push(r);
      });

      const aiMsg = {
        role: "ai",
        text: answer,
        time: nowTime(),
        refs: refsUsed.length ? refsUsed : serialized.refs.slice(0, 8),
        subgraph,
        confidence: 0.85 + Math.min(0.1, refsUsed.length * 0.01),
      };
      setMessages((m) => [...m, aiMsg]);

      // Voice
      const ctrl = new AbortController();
      ttsAbortRef.current = ctrl;
      window.Providers.TTS.speak({
        providerId: voiceId,
        text: stripCitations(answer),
        key: voiceKey,
        signal: ctrl.signal,
      });
    } catch (e) {
      console.error(e);
      setMessages((m) => [...m, { role: "ai", text: "[error: " + (e?.message || e) + "]", time: nowTime() }]);
    } finally {
      setBusy(false);
    }
  }

  function stripCitations(s) {
    return s.replace(/\[[a-z]\d+\]/g, "").replace(/\s{2,}/g, " ").trim();
  }

  // ---------- Push-to-talk ----------
  function onPttDown() {
    if (sttListening) return;
    if (!window.Providers.STT.available) {
      setMessages((m) => [...m, { role: "ai", text: "[speech recognition not available in this browser — try Chrome]", time: nowTime() }]);
      return;
    }
    window.Providers.TTS.cancel();
    sttTextRef.current = "";
    setSttListening(true);
    sttStopRef.current = window.Providers.STT.start(
      (text, isFinal) => { sttTextRef.current = text; },
      () => {
        setSttListening(false);
        const t = sttTextRef.current.trim();
        if (t) handleSend(t);
      }
    );
  }
  function onPttUp() {
    if (sttStopRef.current) sttStopRef.current();
    sttStopRef.current = null;
  }

  // ---------- Render ----------
  const llmLabel = llm?.label ?? llmId;
  const voiceLabel = voice?.label ?? voiceId;

  return (
    <React.Fragment>
      <Topbar
        tab={tab} onTab={setTab}
        clipId={clipId}
        onOpenProviders={() => setDrawerOpen(true)}
        aiOn={aiOn} onAiToggle={() => setAiOn(!aiOn)}
        llmLabel={shortenLabel(llmLabel)}
        voiceLabel={shortenLabel(voiceLabel)}
      />

      {tab === "instruction" ? (
        <main className="main">
          <StepsPanel
            graph={graph}
            activeEventId={activeEventId}
            onPickStep={setActiveEventId}
          />
          <VideoPanel
            graph={graph}
            activeEventId={activeEventId}
            progress={progress}
            onScrub={setProgress}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            onJumpEvent={setActiveEventId}
          />
          <ChatPanel
            aiOn={aiOn}
            messages={messages}
            busy={busy}
            onSend={handleSend}
            onShowGraph={setOverlay}
            voiceMode={voiceMode}
            sttListening={sttListening}
            onPttDown={onPttDown}
            onPttUp={onPttUp}
            llmLabel={shortenLabel(llmLabel)}
            voiceLabel={shortenLabel(voiceLabel)}
            clipId={clipId}
          />
        </main>
      ) : (
        <ConfigPage
          graph={graph}
          clipId={clipId} clips={window.GraphStore.listClips()} onSwitchClip={setClipId}
          llmId={llmId} onLlm={setLlmId}
          voiceId={voiceId} onVoice={setVoiceId}
          voiceMode={voiceMode} onVoiceMode={setVoiceMode}
          llmKey={llmKey} onLlmKey={setLlmKey}
          voiceKey={voiceKey} onVoiceKey={setVoiceKey}
          llmEndpoint={llmEndpoint} onLlmEndpoint={setLlmEndpoint}
        />
      )}

      <ProviderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        llmId={llmId} onLlm={setLlmId}
        voiceId={voiceId} onVoice={setVoiceId}
        voiceMode={voiceMode} onVoiceMode={setVoiceMode}
        llmKey={llmKey} onLlmKey={setLlmKey}
        voiceKey={voiceKey} onVoiceKey={setVoiceKey}
        llmEndpoint={llmEndpoint} onLlmEndpoint={setLlmEndpoint}
      />

      <GraphOverlay subgraph={overlay} onClose={() => setOverlay(null)} />
      <SetupBanner onOpen={() => setDrawerOpen(true)} />
    </React.Fragment>
  );
}

function shortenLabel(s) {
  if (!s) return s;
  return s.length > 24 ? s.slice(0, 23) + "…" : s;
}

// Banner shown when no real LLM is wired up (i.e. outside Claude Design).
function SetupBanner({ onOpen }) {
  const hasBuiltin = typeof window.claude?.complete === "function";
  if (hasBuiltin) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      zIndex: 80,
      background: "var(--bg-3)",
      border: "1px solid var(--border-accent)",
      borderRadius: "var(--r2)",
      padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 12,
      fontSize: "var(--text-sm)",
      color: "var(--fg-2)",
      boxShadow: "var(--shadow-float)",
      maxWidth: "min(560px, 90vw)",
    }}>
      <span style={{ color: "var(--accent-400)", fontWeight: 500 }}>⚙</span>
      <span>
        Configure an LLM provider to ask the graph questions.{" "}
        <span
          onClick={onOpen}
          style={{ color: "var(--accent-400)", cursor: "pointer", textDecoration: "underline" }}
        >
          Open AI Configuration →
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Configuration page (full version of the drawer + retrieval settings).
// ---------------------------------------------------------------------------
function ConfigPage(props) {
  const {
    graph, clipId, clips, onSwitchClip,
    llmId, onLlm, voiceId, onVoice, voiceMode, onVoiceMode,
    llmKey, onLlmKey, voiceKey, onVoiceKey, llmEndpoint, onLlmEndpoint,
  } = props;
  const llms = window.Providers.LLM.list();
  const voices = window.Providers.TTS.list();
  return (
    <main style={{ overflow: "auto", padding: "32px 48px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <span className="mono-caps">Settings</span>
        <h1 className="mt-2">AI Configuration</h1>
        <p className="mt-2" style={{ maxWidth: 680 }}>
          Same retrieval contract, swappable providers. Every cloud and local model speaks the same{" "}
          <code style={{ color: "var(--accent-300)" }}>LLMProvider</code> interface — the rest of the app stays the same.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <ConfigCard title="LLM provider" subtitle="Cloud or local — choose one.">
          {llms.map((p) => (
            <div key={p.id} className={"row" + (p.id === llmId ? " active" : "")} onClick={() => onLlm(p.id)}>
              <div className="dot" />
              <div>
                <div className="name">{p.label}</div>
                <div className="ep">{p.endpoint}</div>
              </div>
              <span className={"pill " + (p.kind === "local" ? "local" : "")}>{p.kind}</span>
            </div>
          ))}
          <div className="field mt-3">
            <div className="label">Endpoint URL</div>
            <input value={llmEndpoint} onChange={(e) => onLlmEndpoint(e.target.value)} placeholder={llms.find((p) => p.id === llmId)?.endpoint} />
          </div>
          {llms.find((p) => p.id === llmId)?.needsKey && (
            <div className="field mt-3">
              <div className="label">API key</div>
              <input type="password" value={llmKey} onChange={(e) => onLlmKey(e.target.value)} placeholder="sk-•••" />
            </div>
          )}
        </ConfigCard>

        <ConfigCard title="Voice provider" subtitle="Text-to-speech.">
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
            <div className="field mt-3">
              <div className="label">API key</div>
              <input type="password" value={voiceKey} onChange={(e) => onVoiceKey(e.target.value)} placeholder="eleven-•••" />
            </div>
          )}
          <div className="field mt-3">
            <div className="label">Voice mode</div>
            <div className="flex gap-2">
              {["push-to-talk", "always-on"].map((m) => (
                <button key={m} className={"btn " + (voiceMode === m ? "primary" : "")} onClick={() => onVoiceMode(m)}>{m}</button>
              ))}
            </div>
          </div>
        </ConfigCard>

        <ConfigCard title="Graph retrieval" subtitle="What the agent is grounded in.">
          <div className="field">
            <div className="label">Active clip</div>
            <select value={clipId} onChange={(e) => onSwitchClip(e.target.value)}>
              {clips.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field mt-3">
            <div className="label">Graph source</div>
            <input disabled value="IndustReal_Pipeline/results/neo4j/*.csv  +  results/raw_cad_pilot/*.json" />
          </div>
          <div className="flex gap-3 mt-3">
            <div className="field flex-1"><div className="label">Traversal depth</div><input disabled value="2 hops" /></div>
            <div className="field flex-1"><div className="label">Top-k nodes</div><input disabled value="14" /></div>
          </div>
          <div className="field mt-3">
            <div className="label">Node types allowed</div>
            <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
              {["Goal", "Phase", "Event", "Component", "Clip"].map((t) => (
                <span key={t} className="chip active"><span className="kind">node</span><span>{t}</span></span>
              ))}
            </div>
          </div>
        </ConfigCard>

        <ConfigCard title="System prompt" subtitle="Template used for every query. Cited node ids are required.">
          <pre style={{
            background: "var(--bg-1)", border: "1px dashed var(--border-2)",
            borderRadius: "var(--r2)", padding: 12, margin: 0,
            color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55,
            whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 320,
          }}>
{`You are the Grounding Agent for IndustReal clip {{clip}}.
Answer ONLY from the assembly subgraph below. Each fact must cite at
least one node id like [e2] or [p3]. If the subgraph does NOT contain
an answer, say so plainly and propose the closest grounded node.

## ACTIVE STEP
{{active_step_line}}

## SUBGRAPH (retrieved from Neo4j)
{{serialized_subgraph}}

## USER QUESTION
{{question}}`}
          </pre>
        </ConfigCard>
      </div>
    </main>
  );
}

function ConfigCard({ title, subtitle, children }) {
  return (
    <div style={{
      background: "var(--bg-2)",
      border: "1px solid var(--border-2)",
      borderRadius: "var(--r3)",
      padding: 24,
    }}>
      <h3 style={{ marginBottom: 4 }}>{title}</h3>
      <p className="p-sm fg-3" style={{ marginBottom: 16 }}>{subtitle}</p>
      <div className="flex-col gap-2">{children}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
