"""Composition root: connect the platform jobs ledger to its domain runners.

The queue (platform/jobs.py) is pure mechanics and imports no domains; this module —
imported once at app startup — is where each job kind meets the code that runs it.
"""

from __future__ import annotations

from typing import Any

from app.content.documents import resolve_doc_id
from app.content.scope import _scope_section_keys
from app.pipeline.build import run_extract
from app.pipeline.ingest import run_convert
from app.extraction.reading_guide import author_guides_sync
from app.extraction.skeleton import refresh_orient, refresh_skeleton
from app.media.audiobook import run_audiobook
from app.platform import jobs
from app.study.concept_quiz_llm import author_scope_sync


def _latest_doc_id() -> str | None:
    # Injected into platform/jobs (set_doc_resolver) — the dependency-inversion seam that
    # keeps platform below content while sharing the one resolve rule.
    return resolve_doc_id(None)


def _run_quizzes(job: dict[str, Any], ctx) -> dict[str, Any]:
    keys = sorted(_scope_section_keys(job["docId"], job["scope"]) or {job["scope"]})
    return author_scope_sync(job["docId"], keys, on_progress=ctx.progress)


def _run_guides(job: dict[str, Any], ctx) -> dict[str, Any]:
    return author_guides_sync(job["docId"], job["scope"], on_progress=ctx.progress)


def _run_skeleton(job: dict[str, Any], ctx) -> dict[str, Any]:
    return refresh_skeleton(job["docId"], job["scope"])


def _run_orient(job: dict[str, Any], ctx) -> dict[str, Any]:
    return refresh_orient(job["docId"], job["scope"])


def install() -> None:
    jobs.set_doc_resolver(_latest_doc_id)
    jobs.register_runner("convert", run_convert)
    jobs.register_runner("build", run_extract)  # compat alias — deep overlay retired
    jobs.register_runner("extract", run_extract)
    jobs.register_runner("quizzes", _run_quizzes)
    jobs.register_runner("guides", _run_guides)
    jobs.register_runner("skeleton", _run_skeleton)
    jobs.register_runner("orient", _run_orient)
    jobs.register_runner("audiobook", run_audiobook)
