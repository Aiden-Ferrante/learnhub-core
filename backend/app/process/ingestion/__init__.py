"""Ingestion — a document in.

Owns: the pluggable PDF→markdown converters (reader: Docling on GPU, pymupdf
fallback) and the conversion drivers that validate, convert, and persist a
document — ``pdf_convert`` for rendered books, ``md_convert`` for authored ones.
Depends on: process/content (persist), gateways.

The two drivers return the same ``ConvertResult`` and raise the same error type, so
the conductor picks one by file extension and is otherwise format-blind.
"""

from app.process.ingestion.md_convert import (
    MARKDOWN_SUFFIXES,
    convert_markdown_bytes,
    is_markdown_filename,
)
from app.process.ingestion.pdf_convert import convert_pdf_bytes, source_hash_of
from app.process.ingestion.reader import PdfConvertError

__all__ = [
    "MARKDOWN_SUFFIXES",
    "PdfConvertError",
    "convert_markdown_bytes",
    "convert_pdf_bytes",
    "is_markdown_filename",
    "source_hash_of",
]
