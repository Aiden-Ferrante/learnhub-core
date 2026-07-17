"""Ingestion — PDF in.

Owns: the pluggable PDF→markdown converters (reader: Docling on GPU, pymupdf
fallback) and the conversion driver that validates, converts, and persists a
document (pdf_convert). Depends on: process/content (persist), gateways.
"""

from app.process.ingestion.pdf_convert import convert_pdf_bytes, source_hash_of
from app.process.ingestion.reader import PdfConvertError

__all__ = [
    "PdfConvertError",
    "convert_pdf_bytes",
    "source_hash_of",
]
