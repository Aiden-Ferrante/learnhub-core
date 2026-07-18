"""Gateways — the connections to programs outside this process.

Owns: the Postgres pool + X-User-Db schema tenancy (db), the persistent jobs
ledger stored in that database (ledger — rows only; the worker that drains it is
conductor/worker), the Ollama client (llm) and the Pydantic schemas for structured
LLM output (llm_schemas). Depends on: nothing inside the app — gateways never
import up.
"""

from app.gateways.db import db, set_request_db_name
from app.gateways.ledger import (
    JobCancelled,
    KINDS,
    cancel_build,
    check_cancel,
    enqueue_build,
    list_builds,
    next_job,
    queue_paused,
    queue_summary,
    requeue_interrupted,
    set_doc_resolver,
    set_queue_paused,
    update_job,
)
from app.gateways.llm import ollama_base_url, ollama_model, ollama_structured_completion
from app.gateways.llm_schemas import ConceptResult, ConceptVerdict, Orient, ReadingGuide, Skeleton

__all__ = [
    "ConceptResult",
    "ConceptVerdict",
    "JobCancelled",
    "KINDS",
    "Orient",
    "ReadingGuide",
    "Skeleton",
    "cancel_build",
    "check_cancel",
    "db",
    "enqueue_build",
    "list_builds",
    "next_job",
    "ollama_base_url",
    "ollama_model",
    "ollama_structured_completion",
    "queue_paused",
    "queue_summary",
    "requeue_interrupted",
    "set_doc_resolver",
    "set_queue_paused",
    "set_request_db_name",
    "update_job",
]
