"""Conductor — decides what runs, and wires it.

The ledger itself (job rows, enqueue/cancel/list) is gateways/ledger — pure data.
This package gives it life: the one daemon worker that drains it (worker: the loop,
the runner registry, JobCtx), which code runs each job kind, and what chains to what.

Owns: upload staging (ingest: prepare_upload + the convert runner), the extract
runner + eval hook (build), the converted→extract auto-chain (lifecycle), the queue
worker (worker), and the composition root that registers every job-kind runner and
starts the worker (registry: install). Depends on: every domain it conducts — by
design, at the top of the domain stack.
"""

from app.conductor.ingest import prepare_upload
from app.conductor.registry import install

__all__ = [
    "install",
    "prepare_upload",
]
