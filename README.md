# XR Event Grounding

A graph-grounded assembly AI assistant built on the [IndustReal](https://github.com/TimSchoonbeek/IndustReal) pipeline.

Three-pane operator console — **Steps · Video · Agent** — where the AI agent can only answer questions grounded in the assembly graph the IndustReal pipeline produces.

## Quick start (GitHub Codespaces)

### Frontend (no backend needed)

```bash
cd platform
python3 -m http.server 8080
```

Codespaces will prompt you to open port 8080. Click it. Then open **AI Configuration** in the top bar and enter an API key (OpenAI, Anthropic, or point at a local Ollama instance).

### Backend (optional — server-side RAG + TTS)

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # then fill in your keys
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Open the **Ports** tab in VS Code, right-click port 8000, set visibility to **Public**.

## Project layout

```
platform/           # Frontend — open Platform.html in any browser
  Platform.html     # Entry point
  src/              # React components, graph store, retriever, providers
  data/             # Pre-built graph data from IndustReal pipeline

backend/            # FastAPI server (optional)
  main.py           # /clips  /query  /tts  /providers
  graph_store.py    # JSONGraphStore + Neo4jGraphStore (same interface)
  retriever.py      # Graph-only BFS RAG
  providers.py      # LLM + TTS provider adapters
  requirements.txt

IndustReal_Pipeline/
  results/          # JSON outputs the pipeline produces (graph source)

ARCHITECTURE.md     # Full architecture doc
```

## LLM providers supported

| Provider | Where configured |
|---|---|
| OpenAI GPT-4o | API key in AI Configuration |
| Anthropic Claude | API key in AI Configuration |
| Ollama (local) | Run `ollama serve` + `ollama pull llama3.1` |
| LM Studio (local) | Start LM Studio server |
| ElevenLabs TTS | API key in AI Configuration |
| Browser TTS | Built-in, no key needed |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system diagram, the `GraphStore` and `LLMProvider` interfaces, and the phased build plan.
