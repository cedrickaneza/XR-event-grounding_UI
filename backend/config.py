"""Environment / config loading."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    graph_backend: str = os.getenv("GRAPH_BACKEND", "json")
    industreal_results_root: str = os.getenv("INDUSTREAL_RESULTS_ROOT", "../IndustReal_Pipeline/results")

    neo4j_uri: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    neo4j_user: str = os.getenv("NEO4J_USER", "neo4j")
    neo4j_password: str = os.getenv("NEO4J_PASSWORD", "")

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "")
    elevenlabs_api_key: str = os.getenv("ELEVENLABS_API_KEY", "")

    ollama_endpoint: str = os.getenv("OLLAMA_ENDPOINT", "http://localhost:11434")
    lmstudio_endpoint: str = os.getenv("LMSTUDIO_ENDPOINT", "http://localhost:1234/v1")

    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))


SETTINGS = Settings()
