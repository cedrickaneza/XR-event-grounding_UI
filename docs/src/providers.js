// providers.js — open-architecture provider registry.
//
// One interface per capability. Each adapter is a thin shim around the
// vendor's API (or a built-in / browser API). Adding a new model = adding
// one entry here.
//
// Capabilities:
//   LLMProvider.complete({ systemPrompt, messages, signal }) -> Promise<string>
//   TTSProvider.speak(text, signal)                          -> Promise<void>
//   STTProvider.start(onResult, onEnd)                       -> stopFn
//
// The in-browser demo defaults to providers that work without keys:
//   - LLM: built-in (window.claude.complete) — no key, rate-limited
//   - TTS: browser SpeechSynthesis — no key
//   - STT: browser SpeechRecognition — no key
//
// Other providers are wired but show a "configure key" hint if no key has
// been entered. The point is the architecture: every adapter speaks the
// same interface, the rest of the app doesn't care which one is active.

(function () {
  // ============================================================
  // LLM
  // ============================================================

  const llmRegistry = [
    {
      id: "claude-builtin",
      label: "Claude (built-in · Haiku)",
      kind: "builtin",
      needsKey: false,
      endpoint: "window.claude.complete",
      adapter: async ({ systemPrompt, userMessage }) => {
        if (typeof window.claude?.complete !== "function") {
          return [
            "⚙ No LLM provider configured.",
            "",
            "This platform works with any of the following providers — pick one in AI Configuration:",
            "  • OpenAI · GPT-4o  (enter your OPENAI_API_KEY)",
            "  • Anthropic · Claude Sonnet  (enter your ANTHROPIC_API_KEY)",
            "  • Ollama (local)  (run `ollama serve` + `ollama pull llama3.1`)",
            "  • LM Studio (local)  (start the LM Studio server)",
            "",
            "The built-in Claude provider is only available inside Claude Design. " +
            "Open AI Configuration (top bar) and select a provider to start asking questions.",
          ].join("\n");
        }
        return await window.claude.complete({
          messages: [
            { role: "user", content: `${systemPrompt}\n\n${userMessage}` },
          ],
        });
      },
    },
    {
      id: "openai-gpt4o",
      label: "OpenAI · GPT-4o",
      kind: "cloud",
      needsKey: true,
      endpoint: "https://api.openai.com/v1/chat/completions",
      adapter: async ({ systemPrompt, userMessage, key }) => {
        if (!key) return mockUnconfigured("OpenAI", "OPENAI_API_KEY");
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            temperature: 0.2,
          }),
        });
        const j = await r.json();
        return j?.choices?.[0]?.message?.content ?? "(no response)";
      },
    },
    {
      id: "anthropic-claude",
      label: "Anthropic · Claude Sonnet",
      kind: "cloud",
      needsKey: true,
      endpoint: "https://api.anthropic.com/v1/messages",
      adapter: async ({ systemPrompt, userMessage, key }) => {
        if (!key) return mockUnconfigured("Anthropic", "ANTHROPIC_API_KEY");
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 800,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          }),
        });
        const j = await r.json();
        return j?.content?.[0]?.text ?? "(no response)";
      },
    },
    {
      id: "google-gemini",
      label: "Google · Gemini 1.5",
      kind: "cloud",
      needsKey: true,
      endpoint: "https://generativelanguage.googleapis.com",
      adapter: async ({ systemPrompt, userMessage, key }) => {
        if (!key) return mockUnconfigured("Gemini", "GOOGLE_API_KEY");
        return "[Gemini adapter — implementation lives in backend/providers.py for production. Plug your API key in here for a browser fallback.]";
      },
    },
    {
      id: "ollama-local",
      label: "Ollama (local)",
      kind: "local",
      needsKey: false,
      endpoint: "http://localhost:11434/api/chat",
      adapter: async ({ systemPrompt, userMessage, endpoint }) => {
        try {
          const r = await fetch((endpoint || "http://localhost:11434") + "/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "llama3.1",
              stream: false,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
              ],
            }),
          });
          const j = await r.json();
          return j?.message?.content ?? "(no response)";
        } catch (e) {
          return `[Ollama not reachable at ${endpoint || "http://localhost:11434"}. Start \`ollama serve\` and pull a model, e.g. \`ollama pull llama3.1\`.]`;
        }
      },
    },
    {
      id: "lmstudio-local",
      label: "LM Studio (local)",
      kind: "local",
      needsKey: false,
      endpoint: "http://localhost:1234/v1/chat/completions",
      adapter: async ({ systemPrompt, userMessage, endpoint }) => {
        try {
          const r = await fetch((endpoint || "http://localhost:1234/v1") + "/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "local-model",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
              ],
              temperature: 0.2,
            }),
          });
          const j = await r.json();
          return j?.choices?.[0]?.message?.content ?? "(no response)";
        } catch (e) {
          return `[LM Studio not reachable at ${endpoint}. Start the LM Studio server.]`;
        }
      },
    },
  ];

  function mockUnconfigured(name, envVar) {
    return [
      `[${name} adapter is wired but no API key is set.]`,
      ``,
      `In a real deployment, this call would hit ${name} with your ${envVar}.`,
      `For now the built-in provider is doing the actual generation.`,
    ].join("\n");
  }

  const LLM = {
    list: () => llmRegistry,
    find: (id) => llmRegistry.find((p) => p.id === id),
    async complete({ providerId, systemPrompt, userMessage, key, endpoint, signal }) {
      const p = LLM.find(providerId);
      if (!p) throw new Error("Unknown LLM provider: " + providerId);
      return await p.adapter({ systemPrompt, userMessage, key, endpoint, signal });
    },
  };

  // ============================================================
  // TTS
  // ============================================================

  const ttsRegistry = [
    {
      id: "browser-tts",
      label: "Browser (Web Speech)",
      kind: "local",
      needsKey: false,
      endpoint: "navigator.speechSynthesis",
      adapter: (text, signal) =>
        new Promise((resolve) => {
          if (!("speechSynthesis" in window)) return resolve();
          const u = new SpeechSynthesisUtterance(text);
          u.rate = 1.02; u.pitch = 1.0;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          if (signal) signal.addEventListener("abort", () => { speechSynthesis.cancel(); resolve(); });
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
        }),
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      kind: "cloud",
      needsKey: true,
      endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
      adapter: async (text, signal, { key, voiceId = "21m00Tcm4TlvDq8ikWAM" } = {}) => {
        if (!key) return; // silently no-op; UI surfaces the unconfigured state
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({ text, model_id: "eleven_turbo_v2" }),
          signal,
        });
        if (!r.ok) return;
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await new Promise((res) => { audio.onended = res; audio.play(); });
      },
    },
    {
      id: "openai-tts",
      label: "OpenAI TTS",
      kind: "cloud",
      needsKey: true,
      endpoint: "https://api.openai.com/v1/audio/speech",
      adapter: async (text, signal, { key, voice = "alloy" } = {}) => {
        if (!key) return;
        const r = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "tts-1", voice, input: text }),
          signal,
        });
        if (!r.ok) return;
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await new Promise((res) => { audio.onended = res; audio.play(); });
      },
    },
    {
      id: "piper-local",
      label: "Piper (local)",
      kind: "local",
      needsKey: false,
      endpoint: "http://localhost:5000/api/tts",
      adapter: async (text, signal, { endpoint = "http://localhost:5000/api/tts" } = {}) => {
        try {
          const r = await fetch(endpoint, {
            method: "POST", body: JSON.stringify({ text }),
            headers: { "Content-Type": "application/json" }, signal,
          });
          if (!r.ok) return;
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          await new Promise((res) => { audio.onended = res; audio.play(); });
        } catch (e) { /* unreachable */ }
      },
    },
  ];

  const TTS = {
    list: () => ttsRegistry,
    find: (id) => ttsRegistry.find((p) => p.id === id),
    async speak({ providerId, text, key, endpoint, signal }) {
      const p = TTS.find(providerId);
      if (!p) return;
      await p.adapter(text, signal, { key, endpoint });
    },
    cancel() {
      try { window.speechSynthesis?.cancel(); } catch (e) {}
    },
  };

  // ============================================================
  // STT — push-to-talk
  // ============================================================

  const STT = {
    available: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    start(onResult, onEnd) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        onResult("(speech recognition not available in this browser)", true);
        onEnd?.();
        return () => {};
      }
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";
      let final = "";
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        onResult(final + interim, !!ev.results[ev.results.length - 1]?.isFinal);
      };
      rec.onend = () => onEnd?.(final);
      rec.onerror = () => onEnd?.(final);
      rec.start();
      return () => { try { rec.stop(); } catch (e) {} };
    },
  };

  window.Providers = { LLM, TTS, STT };
})();
