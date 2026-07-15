"""Ingestion — PDF in.

Owns: the pluggable PDF→markdown converters (reader: Docling on GPU, pymupdf
fallback) and the conversion driver that validates, converts, and persists a
document (pdf_convert). Depends on: content (persist), platform.
"""

from app.ingestion.pdf_convert import convert_pdf_bytes, source_hash_of
from app.ingestion.reader import PdfConvertError

__all__ = [
    "PdfConvertError",
    "convert_pdf_bytes",
    "source_hash_of",
]
