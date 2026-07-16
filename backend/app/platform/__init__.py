"""Platform — the floor every package stands on.

Owns: the Postgres pool + X-User-Db schema tenancy (db), the persistent job
ledger/queue with its single worker (jobs — runners are injected, never imported),
the Ollama client (llm) and the Pydantic schemas for structured LLM output
(llm_schemas). Depends on: nothing inside the app — platform never imports up.
"""

from app.platform.db import db, set_request_db_name
from app.platform.jobs import JobCancelled, KINDS, cancel_build, enqueue_build, ensure_worker, list_builds, queue_summary, register_runner, set_doc_resolver, set_queue_paused
from app.platform.llm import ollama_base_url, ollama_model, ollama_structured_completion
from app.platform.llm_schemas import Augment, AuthoredSet, ConceptResult, ConceptVerdict, GuidedScript, Orient, ReadingGuide, Skeleton

__all__ = [
    "Augment",
    "AuthoredSet",
    "ConceptResult",
    "ConceptVerdict",
    "GuidedScript",
    "JobCancelled",
    "KINDS",
    "Orient",
    "ReadingGuide",
    "Skeleton",
    "cancel_build",
    "db",
    "enqueue_build",
    "ensure_worker",
    "list_builds",
    "ollama_base_url",
    "ollama_model",
    "ollama_structured_completion",
    "queue_summary",
    "register_runner",
    "set_doc_resolver",
    "set_queue_paused",
    "set_request_db_name",
]
