"""Composition root: connect the platform jobs ledger to its domain runners.

The queue (platform/jobs.py) is pure mechanics and imports no domains; this module —
imported once at app startup — is where each job kind meets the code that runs it.
"""

from __future__ import annotations

from typing import Any

from app.content.documents import fetch_latest_document
from app.content.scope import _scope_section_keys
from app.pipeline.build import run_build, run_deep, run_extract
from app.pipeline.ingest import run_convert
from app.extraction.reading_guide import author_guides_sync
from app.extraction.skeleton import refresh_orient, refresh_skeleton
from app.media.audiobook import run_audiobook
from app.platform import jobs
from app.study.concept_quiz_llm import author_scope_sync


def _latest_doc_id() -> str | None:
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


def _run_quizzes(db, job: dict[str, Any], ctx) -> dict[str, Any]:
    keys = sorted(_scope_section_keys(job["docId"], job["scope"]) or {job["scope"]})
    return author_scope_sync(db, job["docId"], keys, on_progress=ctx.progress)


def _run_guides(db, job: dict[str, Any], ctx) -> dict[str, Any]:
    return author_guides_sync(job["docId"], job["scope"], on_progress=ctx.progress)


def _run_skeleton(db, job: dict[str, Any], ctx) -> dict[str, Any]:
    return refresh_skeleton(job["docId"], job["scope"])


def _run_orient(db, job: dict[str, Any], ctx) -> dict[str, Any]:
    return refresh_orient(job["docId"], job["scope"])


def install() -> None:
    jobs.set_doc_resolver(_latest_doc_id)
    jobs.register_runner("convert", run_convert)
    jobs.register_runner("build", run_build)
    jobs.register_runner("extract", run_extract)
    jobs.register_runner("deep", run_deep)
    jobs.register_runner("quizzes", _run_quizzes)
    jobs.register_runner("guides", _run_guides)
    jobs.register_runner("skeleton", _run_skeleton)
    jobs.register_runner("orient", _run_orient)
    jobs.register_runner("audiobook", run_audiobook)
