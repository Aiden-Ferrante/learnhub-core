"""Phase 1 conductor — ingestion: raw PDF → converted markdown → persisted content.

The single entry point for "ingest a document," so phase 1 is one legible thing. The
actual work lives in the domains: conversion in ingestion/ (reader, pdf_convert) and
persistence in content/ (store). The route layer calls here, not the implementers.
"""

from __future__ import annotations

from app.ingestion.pdf_convert import (
    PdfConvertError,
    convert_pdf_bytes,
    find_existing_ingest,
    pdf_convert_health,
)

__all__ = ["ingest_pdf", "find_existing_ingest", "pdf_convert_health", "PdfConvertError"]


def ingest_pdf(data: bytes, filename: str):
    """Convert a PDF and persist its structured content; returns the convert result."""
    return convert_pdf_bytes(data, filename)
