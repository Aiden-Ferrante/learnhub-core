"""Ollama chat completions over the native HTTP API (httpx, no framework).

JSON-schema/Pydantic-constrained generation, keyless and fully local. Calls Ollama's
**native** ``/api/chat`` endpoint (NOT the OpenAI-compat ``/v1`` shim) with ``format``
set to a JSON schema, so the model is grammar-constrained to emit matching JSON.
``OLLAMA_BASE_URL`` is the native root (``http://host:11434``); a stale ``/v1`` suffix
from old .env files is stripped defensively.

The public helper (``ollama_structured_completion``) keeps its ``(result, error)``
tuple contract so every call site is unchanged. Per-request model selection (the UI
model picker) is preserved by passing the model per call — nothing is bound at
construction.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from pydantic import BaseModel

DEFAULT_TIMEOUT = 120.0


def ollama_base_url() -> str:
    """Ollama's native API root (``http://host:11434``). One defensive strip: stale
    ``.env.local`` files may still carry the retired OpenAI-compat ``/v1`` suffix."""
    base = (os.environ.get("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
    return base[:-3].rstrip("/") if base.endswith("/v1") else base


def ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL") or "llama3.1:8b"


def _num_ctx() -> int:
    """Context window for EVERY Ollama call. Left unset, Ollama's server default (2-4K
    tokens) silently TRUNCATES longer prompts — with a ~4K-char extraction system prompt
    that meant long sections lost their tails and nobody saw an error. The GB10's unified
    memory affords a generous window; override via ``OLLAMA_NUM_CTX``."""
    try:
        return int(os.environ.get("OLLAMA_NUM_CTX") or 32768)
    except ValueError:
        return 32768


def ollama_structured_completion(
    messages: list[dict[str, str]],
    json_schema: dict[str, Any] | type[BaseModel],
    temperature: float = 0.2,
    model: str | None = None,
    timeout: float = 300.0,
) -> tuple[dict[str, Any] | None, str | None]:
    """Chat completion constrained to a schema. Returns ``(parsed_obj, error)``.

    ``json_schema`` may be either a raw JSON-schema ``dict`` or a Pydantic ``BaseModel``
    subclass. Either way Ollama's native ``format`` field constrains generation to the
    schema. Pydantic inputs are validated on the way out (coercion + defaults) and
    ``model_dump()``-ed, so downstream key names are unchanged (the schema classes use
    wire-format field names directly — no aliasing)."""
    pyd = isinstance(json_schema, type) and issubclass(json_schema, BaseModel)
    schema = json_schema.model_json_schema() if pyd else json_schema
    try:
        resp = httpx.post(
            f"{ollama_base_url()}/api/chat",
            json={
                "model": model or ollama_model(),
                "messages": messages,
                "format": schema,
                "stream": False,
                "options": {"temperature": temperature, "num_ctx": _num_ctx()},
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        content = (resp.json().get("message") or {}).get("content") or ""
        if not content.strip():
            return None, "No structured content in response"
        parsed = json.loads(content)
        if pyd:
            parsed = json_schema.model_validate(parsed).model_dump()
        return parsed, None
    except Exception as e:  # noqa: BLE001 — preserve the (None, error) contract for callers
        return None, str(e)
