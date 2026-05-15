# XR Event Grounding · Backend

FastAPI server that exposes the **same retrieval contract** the in-browser
prototype uses, but server-side. Drop in your real keys, point at your real
Neo4j (or run against the JSON exports the IndustReal pipeline already
produces), and ship.

The frontend in `../platform/` is provider-agnostic — it speaks REST. Point
it at this backend by setting the endpoint URL to `http://localhost:8000`
in the AI Configuration drawer.

## Layers

```
main.py             FastAPI app · routes
schemas.py          Pydantic request/response models
graph_store.py      Abstract GraphStore + JSONGraphStore + Neo4jGraphStore
retriever.py        BFS subgraph extraction · serialization for LLM
prompts.py          System prompt template (graph-only RAG)
providers.py        LLMProvider, TTSProvider, STTProvider abstractions
config.py           Environment / .env loading
```

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # edit keys
python main.py
```

Then in the frontend's AI Configuration drawer, set:

- LLM endpoint: `http://localhost:8000`
- Voice endpoint: `http://localhost:8000`

## Provider plug-in pattern

Every provider implements one method. Adding a new model = adding one class:

```python
class MyCustomLLM(LLMProvider):
    name = "my-custom"
    needs_key = True
    endpoint = "https://my-custom-api.example.com"

    async def complete(self, *, system_prompt: str, user_message: str) -> str:
        # call the vendor's API
        ...
```

Then register it in `providers.py::LLM_REGISTRY`. The rest of the app
doesn't care.

## Graph store plug-in pattern

Same idea. Two implementations ship out of the box:

- `JSONGraphStore` — reads `IndustReal_Pipeline/results/*.json` and the
  Neo4j-shaped CSVs your pipeline already exports. No database needed.
- `Neo4jGraphStore` — runs Cypher against a real Neo4j instance.

Both speak the same `GraphStore` interface so the retriever is identical.
