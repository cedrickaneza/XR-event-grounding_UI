"""
Provider plug-in layer.

One abstract class per capability (LLM, TTS, STT) + one adapter per vendor.
Adding a new model = one class. The retriever + API layer call the provider
through the abstract interface and don't care which adapter is loaded.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import httpx

from config import SETTINGS


# ===========================================================================
# LLM
# ===========================================================================


class LLMProvider(ABC):
    name: str
    kind: str       # "cloud" | "local" | "builtin"
    endpoint: str
    needs_key: bool = False

    @abstractmethod
    async def complete(self, *, system_prompt: str, user_message: str) -> str:
        ...

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.name, "label": self.name, "kind": self.kind,
            "endpoint": self.endpoint, "needs_key": self.needs_key,
        }


class OpenAILLM(LLMProvider):
    name = "openai-gpt4o"
    kind = "cloud"
    endpoint = "https://api.openai.com/v1/chat/completions"
    needs_key = True

    async def complete(self, *, system_prompt: str, user_message: str) -> str:
        if not SETTINGS.openai_api_key:
            return "[OpenAI key not configured — set OPENAI_API_KEY]"
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                self.endpoint,
                headers={"Authorization": f"Bearer {SETTINGS.openai_api_key}"},
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                    ],
                    "temperature": 0.2,
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]


class AnthropicLLM(LLMProvider):
    name = "anthropic-claude"
    kind = "cloud"
    endpoint = "https://api.anthropic.com/v1/messages"
    needs_key = True

    async def complete(self, *, system_prompt: str, user_message: str) -> str:
        if not SETTINGS.anthropic_api_key:
            return "[Anthropic key not configured — set ANTHROPIC_API_KEY]"
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                self.endpoint,
                headers={
                    "x-api-key": SETTINGS.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 800,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_message}],
                },
            )
            r.raise_for_status()
            return r.json()["content"][0]["text"]


class OllamaLLM(LLMProvider):
    name = "ollama-local"
    kind = "local"
    needs_key = False

    @property
    def endpoint(self) -> str:
        return SETTINGS.ollama_endpoint

    async def complete(self, *, system_prompt: str, user_message: str) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{self.endpoint}/api/chat",
                json={
                    "model": "llama3.1",
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                    ],
                },
            )
            r.raise_for_status()
            return r.json()["message"]["content"]


class LMStudioLLM(LLMProvider):
    name = "lmstudio-local"
    kind = "local"
    needs_key = False

    @property
    def endpoint(self) -> str:
        return SETTINGS.lmstudio_endpoint

    async def complete(self, *, system_prompt: str, user_message: str) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{self.endpoint}/chat/completions",
                json={
                    "model": "local-model",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                    ],
                    "temperature": 0.2,
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]


LLM_REGISTRY: dict[str, LLMProvider] = {
    p.name: p for p in [OpenAILLM(), AnthropicLLM(), OllamaLLM(), LMStudioLLM()]
}


# ===========================================================================
# TTS
# ===========================================================================


class TTSProvider(ABC):
    name: str
    kind: str
    endpoint: str
    needs_key: bool = False

    @abstractmethod
    async def speak(self, text: str) -> bytes:
        """Return audio bytes (mp3 or wav)."""

    def describe(self) -> dict[str, Any]:
        return {
            "id": self.name, "label": self.name, "kind": self.kind,
            "endpoint": self.endpoint, "needs_key": self.needs_key,
        }


class ElevenLabsTTS(TTSProvider):
    name = "elevenlabs"
    kind = "cloud"
    endpoint = "https://api.elevenlabs.io/v1/text-to-speech"
    needs_key = True

    async def speak(self, text: str) -> bytes:
        if not SETTINGS.elevenlabs_api_key:
            return b""
        voice_id = "21m00Tcm4TlvDq8ikWAM"  # default voice
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{self.endpoint}/{voice_id}",
                headers={
                    "xi-api-key": SETTINGS.elevenlabs_api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                json={"text": text, "model_id": "eleven_turbo_v2"},
            )
            r.raise_for_status()
            return r.content


class OpenAITTS(TTSProvider):
    name = "openai-tts"
    kind = "cloud"
    endpoint = "https://api.openai.com/v1/audio/speech"
    needs_key = True

    async def speak(self, text: str) -> bytes:
        if not SETTINGS.openai_api_key:
            return b""
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                self.endpoint,
                headers={"Authorization": f"Bearer {SETTINGS.openai_api_key}"},
                json={"model": "tts-1", "voice": "alloy", "input": text},
            )
            r.raise_for_status()
            return r.content


TTS_REGISTRY: dict[str, TTSProvider] = {
    p.name: p for p in [ElevenLabsTTS(), OpenAITTS()]
}
