"""Composition root: connect the jobs ledger to its domain runners, then start the worker.

The ledger (gateways/ledger.py) is pure mechanics and imports no domains; this module —
imported once at app startup — is where each job kind meets the code that runs it.
"""

from __future__ import annotations

import threading
from typing import Any

from app.process.content import resolve_doc_id
from app.conductor.build import run_extract
from app.conductor.ingest import run_convert
from app.conductor.worker import ensure_worker, register_runner
from app.process.extraction import author_guides_sync
from app.process.extraction import refresh_orient, refresh_skeleton
from app.gateways import set_doc_resolver
from app.supplemental.media import run_audiobook, warm_tts


def _latest_doc_id() -> str | None:
    # Injected into gateways/ledger (set_doc_resolver) — the dependency-inversion seam that
    # keeps the ledger below process/content while sharing the one resolve rule.
    return resolve_doc_id(None)


def _run_guides(job: dict[str, Any], ctx) -> dict[str, Any]:
    return author_guides_sync(job["docId"], job["scope"], on_progress=ctx.progress)


def _run_skeleton(job: dict[str, Any], ctx) -> dict[str, Any]:
    return refresh_skeleton(job["docId"], job["scope"])


def _run_orient(job: dict[str, Any], ctx) -> dict[str, Any]:
    return refresh_orient(job["docId"], job["scope"])


def install() -> None:
    set_doc_resolver(_latest_doc_id)
    register_runner("convert", run_convert)
    register_runner("build", run_extract)  # compat alias — deep overlay retired
    register_runner("extract", run_extract)
    register_runner("guides", _run_guides)
    register_runner("skeleton", _run_skeleton)
    register_runner("orient", _run_orient)
    register_runner("audiobook", run_audiobook)
    # Load the TTS model off the request path. A fresh container's first narration costs
    # ~19s against ~5.4s warm — torch/CUDA init plus the model load, paid once per process.
    # Daemon thread so it never delays startup and never holds shutdown open.
    threading.Thread(target=warm_tts, name="tts-warm", daemon=True).start()
    # Start the one queue worker with the app — it drains the ledger from here on
    # (enqueue is a pure ledger write; nothing else wakes the worker).
    ensure_worker()
