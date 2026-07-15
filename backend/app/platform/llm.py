"""Ollama chat completions, on LangChain (``langchain-ollama``).

Free-text (Socratic) + JSON-schema/Pydantic-constrained (extraction) generation, all
keyless and fully local. ``ChatOllama`` talks to Ollama's **native** ``/api`` endpoint
(NOT the OpenAI-compat ``/v1`` shim). ``OLLAMA_BASE_URL`` is the native root
(``http://host:11434``); a stale ``/v1`` suffix from old .env files is stripped
the rest of the stack, and we strip it here.

The public helper (``ollama_structured_completion``)
keep their original ``(result, error)`` tuple contract so every call site is unchanged;
LangChain lives entirely behind this boundary. Per-request model selection (the UI model
picker) is preserved by building a fresh ``ChatOllama`` per call via ``get_chat_model`` —
the model is never bound once at construction.
"""

from __future__ import annotations

import os
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_ollama import ChatOllama
from pydantic import BaseModel

DEFAULT_TIMEOUT = 120.0


def ollama_base_url() -> str:
    """Ollama's native API root (``http://host:11434``). One defensive strip: stale
    ``.env.local`` files may still carry the retired OpenAI-compat ``/v1`` suffix."""
    base = (os.environ.get("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
    return base[:-3].rstrip("/") if base.endswith("/v1") else base


def _ollama_model() -> str:
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


def get_chat_model(
    model: str | None = None,
    temperature: float = 0.6,
    timeout: float = DEFAULT_TIMEOUT,
    num_predict: int | None = None,
) -> ChatOllama:
    """Build a ``ChatOllama`` bound to the native Ollama endpoint.

    ``model`` is the UI-selected model (threaded from the request); when omitted it falls
    back to the ``OLLAMA_MODEL`` env default. Construction is cheap (the weights live in the
    Ollama daemon), so we make a fresh client per request to honour the model picker.
    """
    kwargs: dict[str, Any] = {
        "model": model or _ollama_model(),
        "base_url": ollama_base_url(),
        "temperature": temperature,
        "num_ctx": _num_ctx(),
        "client_kwargs": {"timeout": timeout},
    }
    if num_predict is not None:
        kwargs["num_predict"] = num_predict
    return ChatOllama(**kwargs)


def _to_lc_messages(messages: list[dict[str, str]]) -> list[BaseMessage]:
    """Convert the ``[{"role", "content"}]`` wire format into LangChain message objects."""
    out: list[BaseMessage] = []
    for m in messages:
        role = (m.get("role") or "user").lower()
        content = m.get("content") or ""
        if role == "system":
            out.append(SystemMessage(content=content))
        elif role == "assistant":
            out.append(AIMessage(content=content))
        else:
            out.append(HumanMessage(content=content))
    return out


def ollama_structured_completion(
    messages: list[dict[str, str]],
    json_schema: dict[str, Any] | type[BaseModel],
    temperature: float = 0.2,
    model: str | None = None,
    timeout: float = 300.0,
) -> tuple[dict[str, Any] | None, str | None]:
    """Chat completion constrained to a schema. Returns ``(parsed_obj, error)``.

    ``json_schema`` may be either a raw JSON-schema ``dict`` (the historical form) or a
    Pydantic ``BaseModel`` subclass. Either way the model is forced to emit matching JSON via
    Ollama's native ``format`` (``method="json_schema"``), so parsing is handled by LangChain
    and the result is normalised to a plain ``dict`` for callers (Pydantic results are
    ``model_dump(by_alias=True)``-ed so downstream key names are unchanged).
    """
    try:
        llm = get_chat_model(model=model, temperature=temperature, timeout=timeout)
        structured = llm.with_structured_output(json_schema, method="json_schema")
        result = structured.invoke(_to_lc_messages(messages))
        if result is None:
            return None, "No structured content in response"
        if isinstance(result, BaseModel):
            return result.model_dump(by_alias=True), None
        return dict(result), None
    except Exception as e:  # noqa: BLE001 — preserve the (None, error) contract for callers
        return None, str(e)
