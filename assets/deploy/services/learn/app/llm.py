"""Ollama chat completions: free-text (Socratic) + JSON-schema-constrained (extraction)."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

DEFAULT_TIMEOUT = 120.0


def _ollama_base() -> str:
    return (os.environ.get("OLLAMA_BASE_URL") or "http://localhost:11434/v1").rstrip("/")


def _ollama_native_base() -> str:
    """Base URL for Ollama's native API (strip the OpenAI-compat ``/v1`` suffix)."""
    base = _ollama_base()
    return base[:-3].rstrip("/") if base.endswith("/v1") else base


def _ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL") or "llama3.1:8b"


def ollama_chat_completion(
    messages: list[dict[str, str]],
    temperature: float = 0.6,
    model: str | None = None,
) -> tuple[str | None, str | None]:
    """
    Returns (assistant_content, error_message).

    ``model`` is the UI-selected Ollama model (threaded from the request); when
    omitted it falls back to the ``OLLAMA_MODEL`` env default.
    """
    url = f"{_ollama_base()}/chat/completions"
    payload: dict[str, Any] = {
        "model": model or _ollama_model(),
        "messages": messages,
        "temperature": temperature,
    }
    try:
        with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
        choices = data.get("choices") or []
        if not choices:
            return None, "Empty choices from Ollama"
        msg = (choices[0].get("message") or {}).get("content")
        if not msg or not isinstance(msg, str):
            return None, "No assistant content in response"
        return msg.strip(), None
    except httpx.HTTPStatusError as e:
        return None, f"Ollama HTTP {e.response.status_code}: {e.response.text[:500]}"
    except httpx.RequestError as e:
        return None, f"Ollama request failed: {e}"
    except Exception as e:
        return None, str(e)


def ollama_structured_completion(
    messages: list[dict[str, str]],
    json_schema: dict[str, Any],
    temperature: float = 0.2,
    model: str | None = None,
    timeout: float = 300.0,
) -> tuple[dict[str, Any] | None, str | None]:
    """Chat completion constrained to a JSON schema. Returns ``(parsed_obj, error)``.

    Tries the OpenAI-compatible ``/v1`` shim with ``response_format: json_schema`` first
    (no compose changes), and falls back to Ollama's native ``/api/chat`` with ``format``
    if the shim rejects it (older Ollama). Either way the model is forced to emit JSON
    matching ``json_schema``, so parsing is a plain ``json.loads`` — no regex salvage.
    """
    mdl = model or _ollama_model()
    url = f"{_ollama_base()}/chat/completions"
    payload: dict[str, Any] = {
        "model": mdl,
        "messages": messages,
        "temperature": temperature,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "extraction", "strict": True, "schema": json_schema},
        },
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(url, json=payload)
            if r.status_code == 400:  # shim lacks response_format → native fallback
                return _ollama_native_structured(messages, json_schema, temperature, mdl, timeout)
            r.raise_for_status()
            data = r.json()
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
        if not content or not isinstance(content, str):
            return None, "No assistant content in structured response"
        try:
            return json.loads(content), None
        except Exception as e:
            return None, f"JSON parse failed: {e}: {content[:300]}"
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 400:
            return _ollama_native_structured(messages, json_schema, temperature, mdl, timeout)
        return None, f"Ollama HTTP {e.response.status_code}: {e.response.text[:500]}"
    except httpx.RequestError as e:
        return None, f"Ollama request failed: {e}"
    except Exception as e:
        return None, str(e)


def _ollama_native_structured(
    messages: list[dict[str, str]],
    json_schema: dict[str, Any],
    temperature: float,
    model: str,
    timeout: float,
) -> tuple[dict[str, Any] | None, str | None]:
    url = f"{_ollama_native_base()}/api/chat"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "format": json_schema,
        "stream": False,
        "options": {"temperature": temperature},
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
        content = (data.get("message") or {}).get("content")
        if not content or not isinstance(content, str):
            return None, "No content from native Ollama"
        try:
            return json.loads(content), None
        except Exception as e:
            return None, f"native JSON parse failed: {e}: {content[:300]}"
    except Exception as e:
        return None, f"native Ollama failed: {e}"
