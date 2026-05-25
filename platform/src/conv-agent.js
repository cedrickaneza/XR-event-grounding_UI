// conv-agent.js — ElevenLabs Conversational AI WebSocket client.
//
// Protocol: wss://api.elevenlabs.io/v1/convai/conversation
//
// Audio path (in):  getUserMedia → ScriptProcessor → PCM16 16 kHz → base64 → WS
// Audio path (out): WS → base64 PCM16 → Float32 → scheduled AudioContext playback
//
// Client tools let the ElevenLabs agent trigger navigation inside the app.
// Register them in the ElevenLabs dashboard under the same names.
//
// Public API:
//   window.ConvAgent.start(agentId, apiKey, opts) → Promise<void>
//   window.ConvAgent.stop()

(function () {
  'use strict';

  let ws            = null;
  let audioCtx      = null;
  let micStream     = null;
  let scriptNode    = null;
  let nextPlayAt    = 0;
  let outRate       = 16000; // filled from conversation_initiation_metadata
  let speakTimer    = null;  // clears when audio stops arriving → switches back to listening

  // ── Codec helpers ────────────────────────────────────────────────────────

  function b64ToU8(b64) {
    const bin = atob(b64);
    const u8  = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function u8ToB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }

  // PCM16 little-endian → Float32 in [-1, 1]
  function pcm16ToF32(u8) {
    const n   = Math.floor(u8.length / 2);
    const out = new Float32Array(n);
    const dv  = new DataView(u8.buffer, u8.byteOffset);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768.0;
    return out;
  }

  // Float32 → PCM16 little-endian
  function f32ToPcm16(f32) {
    const buf = new ArrayBuffer(f32.length * 2);
    const dv  = new DataView(buf);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      dv.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    return new Uint8Array(buf);
  }

  // Linear resampler (good enough for 44.1 kHz ↔ 16 kHz)
  function resample(f32, fromRate, toRate) {
    if (fromRate === toRate) return f32;
    const ratio  = fromRate / toRate;
    const len    = Math.round(f32.length / ratio);
    const out    = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const pos = i * ratio;
      const lo  = Math.floor(pos);
      const hi  = Math.min(lo + 1, f32.length - 1);
      out[i]    = f32[lo] + (pos - lo) * (f32[hi] - f32[lo]);
    }
    return out;
  }

  // ── Audio playback ────────────────────────────────────────────────────────

  function scheduleChunk(b64) {
    if (!audioCtx) return;
    try {
      const bytes   = b64ToU8(b64);
      const f32     = pcm16ToF32(bytes);
      const resampled = resample(f32, outRate, audioCtx.sampleRate);
      const buf     = audioCtx.createBuffer(1, resampled.length, audioCtx.sampleRate);
      buf.copyToChannel(resampled, 0);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      const at  = Math.max(audioCtx.currentTime + 0.04, nextPlayAt);
      src.start(at);
      nextPlayAt = at + buf.duration;
    } catch (e) {
      console.warn('ConvAgent: playback error', e);
    }
  }

  // ── Microphone ────────────────────────────────────────────────────────────

  async function startMic(sendChunk) {
    // Disable all browser-side audio processing so ElevenLabs receives the
    // raw signal and can run its own VAD / noise suppression on the server.
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src  = audioCtx.createMediaStreamSource(micStream);
    // 2048 samples ≈ 46 ms chunks at 44.1 kHz — smaller and more frequent than 4096.
    scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
    let chunkCount = 0;
    scriptNode.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const raw = e.inputBuffer.getChannelData(0);
      const ds  = resample(raw, audioCtx.sampleRate, 16000);
      sendChunk(u8ToB64(f32ToPcm16(ds)));
      chunkCount++;
      if (chunkCount === 1 || chunkCount % 50 === 0) {
        console.log(`[ConvAgent] mic chunks sent: ${chunkCount} (rate: ${audioCtx.sampleRate} Hz)`);
      }
    };
    src.connect(scriptNode);
    scriptNode.connect(audioCtx.destination); // Chrome requires a live destination to keep the graph active
    console.log('[ConvAgent] mic started, browser sample rate:', audioCtx.sampleRate);
  }

  function stopMic() {
    try { scriptNode?.disconnect(); } catch {}
    try { micStream?.getTracks().forEach((t) => t.stop()); } catch {}
    scriptNode = null;
    micStream  = null;
  }

  // ── Message handler ───────────────────────────────────────────────────────

  async function handleMessage(raw, cbs, tools) {
    // Some ElevenLabs configurations send audio as binary WebSocket frames.
    if (raw instanceof Blob) { raw.arrayBuffer().then((ab) => scheduleBinary(ab, cbs)); return; }
    if (raw instanceof ArrayBuffer) { scheduleBinary(raw, cbs); return; }

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Log every non-trivial message so unexpected formats are visible in the console.
    if (msg.type && msg.type !== 'ping' && !msg.type.startsWith('internal_')) {
      console.log('[ConvAgent] ←', msg.type, msg);
    }

    switch (msg.type) {

      case 'conversation_initiation_metadata': {
        const fmt  = msg.conversation_initiation_metadata_event?.agent_output_audio_format ?? 'pcm_16000';
        const rate = parseInt(fmt.replace(/[^0-9]/g, ''), 10);
        outRate    = rate || 16000;
        console.info('[ConvAgent] audio format:', fmt, '→ outRate:', outRate);
        cbs.onStatus?.('connected');
        cbs.onMode?.('listening');
        try {
          await startMic((b64) => {
            if (ws?.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ user_audio_chunk: b64 }));
          });
        } catch (e) {
          cbs.onStatus?.('error');
          cbs.onError?.(`Microphone error: ${e.message}`);
        }
        break;
      }

      case 'audio': {
        const b64 = msg.audio_event?.audio_base_64 ?? msg.audio_base_64 ?? null;
        if (!b64) { console.warn('[ConvAgent] audio event has no base64:', msg); break; }
        setSpeaking(b64, cbs);
        break;
      }

      case 'agent_response': {
        const text    = msg.agent_response_event?.agent_response ?? '';
        const hasAudio = !!speakTimer; // true if audio chunks already arrived for this turn
        if (text) cbs.onAgentText?.(text, { hasAudio });
        // Fallback animation: if no audio events arrived, drive the orb from text length.
        // Also signals app.jsx that it should use its own TTS to read the response aloud.
        if (!speakTimer) {
          const ms = Math.max(1500, text.length * 70);
          cbs.onMode?.('speaking');
          speakTimer = setTimeout(() => { speakTimer = null; if (ws) cbs.onMode?.('listening'); }, ms);
        }
        break;
      }

      case 'user_transcript': {
        const t = msg.user_transcription_event?.user_transcript ?? '';
        if (t) {
          cbs.onTranscript?.(t);
          cbs.onMode?.('thinking');
          if (speakTimer) { clearTimeout(speakTimer); speakTimer = null; }
        }
        break;
      }

      case 'interruption':
        if (speakTimer) { clearTimeout(speakTimer); speakTimer = null; }
        nextPlayAt = 0;
        cbs.onMode?.('listening');
        break;

      case 'ping':
        ws?.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event.event_id }));
        break;

      case 'client_tool_call': {
        const { tool_call_id, tool_name, parameters } = msg.client_tool_call;
        let result   = 'ok';
        let is_error = false;
        try {
          const fn = tools[tool_name];
          if (fn) result = String((await fn(parameters)) ?? 'ok');
          else { is_error = true; result = `Unknown tool: ${tool_name}`; }
        } catch (e) {
          is_error = true;
          result   = e.message ?? String(e);
        }
        ws?.send(JSON.stringify({ type: 'client_tool_result', tool_call_id, result, is_error }));
        break;
      }

      default: break;
    }
  }

  // Drives speaking mode + timer from a base64 audio chunk.
  function setSpeaking(b64, cbs) {
    cbs.onMode?.('speaking');
    scheduleChunk(b64);
    if (speakTimer) { clearTimeout(speakTimer); speakTimer = null; }
    const remaining = audioCtx ? Math.max(0, nextPlayAt - audioCtx.currentTime) : 0;
    speakTimer = setTimeout(() => {
      speakTimer = null;
      if (ws) cbs.onMode?.('listening');
    }, remaining * 1000 + 400);
  }

  // Handle raw binary audio frames (alternate ElevenLabs delivery mode).
  function scheduleBinary(ab, cbs) {
    try {
      if (!audioCtx) return;
      const u8  = new Uint8Array(ab);
      const f32 = pcm16ToF32(u8);
      const rs  = resample(f32, outRate, audioCtx.sampleRate);
      const buf = audioCtx.createBuffer(1, rs.length, audioCtx.sampleRate);
      buf.copyToChannel(rs, 0);
      const src = audioCtx.createBufferSource();
      src.buffer = buf; src.connect(audioCtx.destination);
      const at  = Math.max(audioCtx.currentTime + 0.04, nextPlayAt);
      src.start(at); nextPlayAt = at + buf.duration;
      if (speakTimer) { clearTimeout(speakTimer); speakTimer = null; }
      speakTimer = setTimeout(() => { speakTimer = null; if (ws) cbs.onMode?.('listening'); },
        (nextPlayAt - audioCtx.currentTime) * 1000 + 400);
      cbs.onMode?.('speaking');
    } catch (e) { console.warn('[ConvAgent] binary audio error:', e); }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function start(agentId, apiKey, opts = {}) {
    const {
      onStatus, onMode, onTranscript, onAgentText, onError,
      tools = {}, dynamicVars = {},
    } = opts;
    const cbs = { onStatus, onMode, onTranscript, onAgentText, onError };

    if (ws) stop();

    audioCtx   = new AudioContext();
    nextPlayAt = 0;
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    onStatus?.('connecting');

    // Private agents need a signed URL fetched server-side with the API key.
    // Public agents can connect directly.
    let wsUrl;
    if (apiKey) {
      try {
        const r = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`,
          { headers: { 'xi-api-key': apiKey } }
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        wsUrl = (await r.json()).signed_url;
      } catch (e) {
        if (audioCtx) { audioCtx.close(); audioCtx = null; }
        onStatus?.('error');
        onError?.(`Failed to connect: ${e.message}`);
        return;
      }
    } else {
      wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      const initMsg = { type: 'conversation_initiation_client_data', dynamic_variables: dynamicVars };
      console.log('[ConvAgent] → sending initiation, dynamic_vars keys:', Object.keys(dynamicVars));
      ws.send(JSON.stringify(initMsg));
    };

    ws.onmessage = (ev) => {
      // Log binary frames so we know if ElevenLabs sends audio that way.
      if (ev.data instanceof Blob || ev.data instanceof ArrayBuffer) {
        console.log('[ConvAgent] ← binary frame, byteLength:', ev.data.size ?? ev.data.byteLength);
      }
      handleMessage(ev.data, cbs, tools);
    };

    ws.onclose = (ev) => {
      console.log('[ConvAgent] WebSocket closed, code:', ev.code, 'reason:', ev.reason);
      stopMic();
      if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
      ws = null;
      onStatus?.('disconnected');
      onMode?.(null);
    };

    ws.onerror = () => {
      onStatus?.('error');
      onError?.('WebSocket connection failed');
    };
  }

  function stop() {
    if (speakTimer) { clearTimeout(speakTimer); speakTimer = null; }
    stopMic();
    if (ws) { try { ws.close(); } catch {} ws = null; }
    if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
  }

  // ── Auto-configure ────────────────────────────────────────────────────────
  // Fetches the agent's current config via the ElevenLabs REST API and PATCHes
  // in the two navigation client tools + {{step_directory}} system prompt var
  // if they are not already present. Returns a summary of what changed.

  const NAV_TOOLS = [
    {
      type: 'client',
      name: 'navigate_to_step',
      description: 'Navigate the XR assembly video and step panel to a specific step number. Use the step number exactly as shown in the left panel of the interface (1-based).',
      parameters: {
        type: 'object',
        properties: {
          step_number: {
            type: 'integer',
            description: 'The step number to navigate to (1-based, as displayed in the left panel)',
          },
        },
        required: ['step_number'],
      },
    },
    {
      type: 'client',
      name: 'navigate_to_phase',
      description: 'Navigate the XR assembly video to the beginning of a specific assembly phase.',
      parameters: {
        type: 'object',
        properties: {
          phase_number: {
            type: 'integer',
            description: 'The phase number to navigate to (1-based, as displayed in the left panel)',
          },
        },
        required: ['phase_number'],
      },
    },
  ];

  const STEP_DIR_VAR  = '{{step_directory}}';
  const STEP_DIR_BLOCK = '\n\n## AVAILABLE ASSEMBLY STEPS\n' + STEP_DIR_VAR;

  async function configureAgent(agentId, apiKey) {
    if (!agentId || !apiKey) throw new Error('Agent ID and API key are required');
    const base    = 'https://api.elevenlabs.io/v1/convai/agents';
    const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };

    // 1. Read current config
    const getRes = await fetch(`${base}/${encodeURIComponent(agentId)}`, { headers });
    if (!getRes.ok) throw new Error(`Could not read agent (HTTP ${getRes.status}). Check your API key and Agent ID.`);
    const agent = await getRes.json();

    const promptCfg      = agent.conversation_config?.agent?.prompt ?? {};
    const existingTools  = promptCfg.tools ?? [];
    const existingPrompt = promptCfg.prompt ?? '';
    const toolNames      = new Set(existingTools.map((t) => t.name));

    // 2. Determine what needs to change
    const toolsToAdd  = NAV_TOOLS.filter((t) => !toolNames.has(t.name));
    const addStepDir  = !existingPrompt.includes(STEP_DIR_VAR);

    if (toolsToAdd.length === 0 && !addStepDir) {
      return { alreadyConfigured: true };
    }

    // 3. PATCH with the additions merged in
    const patch = {
      conversation_config: {
        agent: {
          prompt: {
            ...promptCfg,
            prompt: addStepDir ? existingPrompt + STEP_DIR_BLOCK : existingPrompt,
            tools:  [...existingTools, ...toolsToAdd],
          },
        },
      },
    };

    const patchRes = await fetch(`${base}/${encodeURIComponent(agentId)}`, {
      method:  'PATCH',
      headers,
      body:    JSON.stringify(patch),
    });
    if (!patchRes.ok) throw new Error(`Failed to update agent (HTTP ${patchRes.status})`);

    return {
      toolsAdded:    toolsToAdd.map((t) => t.name),
      promptUpdated: addStepDir,
    };
  }

  window.ConvAgent = { start, stop, configureAgent };
})();
