"""Content — the book itself, and the one scope resolver.

Owns: document metadata + the latest-doc rule + list/delete/overview (documents),
persist + section/page reads (store), scope resolution — what's inside chapter X —
and extraction-ready block loading (scope), markdown→section splitting (sections),
page provenance (pages), the canonical bookmark outline (outline), figures/tables
(elements), the syllabus tree (toc_tree), chapter units + whole-chapter pulls
(chapters), keyword search (find), and math-markdown normalization (math_markdown).
Depends on: gateways.
"""

from app.process.content.chapters import chapter_key_of, chapter_units, fetch_chapter
from app.process.content.documents import (
    delete_document,
    document_overview,
    fetch_latest_document,
    find_by_source_hash,
    list_documents,
    resolve_doc_id,
)
from app.process.content.elements import fetch_elements, figure_path
from app.process.content.find import keyword_search
from app.process.content.math_markdown import normalize_math_in_markdown, replacement_char_ratio
from app.process.content.scope import SectionExtractInput, load_section_blocks, scope_blocks, scope_section_keys
from app.process.content.sections import clean_heading_markup
from app.process.content.store import fetch_outline, fetch_section_content, persist_document
from app.process.content.toc_tree import get_toc_tree

__all__ = [
    "SectionExtractInput",
    "chapter_key_of",
    "chapter_units",
    "clean_heading_markup",
    "delete_document",
    "document_overview",
    "fetch_chapter",
    "fetch_elements",
    "fetch_latest_document",
    "fetch_outline",
    "fetch_section_content",
    "figure_path",
    "find_by_source_hash",
    "get_toc_tree",
    "keyword_search",
    "list_documents",
    "load_section_blocks",
    "normalize_math_in_markdown",
    "persist_document",
    "replacement_char_ratio",
    "resolve_doc_id",
    "scope_blocks",
    "scope_section_keys",
]
