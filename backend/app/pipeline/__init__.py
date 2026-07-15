"""Pipeline — the conductor over the document lifecycle.

Owns: upload staging (ingest: prepare_upload + the convert runner), the extract
runner + eval hook (build), the converted→extract auto-chain (lifecycle), and the
composition root that registers every job-kind runner with platform.jobs
(registry: install). Depends on: every domain it conducts — by design, at the top
of the domain stack.
"""

from app.pipeline.ingest import prepare_upload
from app.pipeline.registry import install

__all__ = [
    "install",
    "prepare_upload",
]
