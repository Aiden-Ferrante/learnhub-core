"""Content — the book itself, and the one scope resolver.

Owns: document metadata + the latest-doc rule (documents), persist + section/page
reads (store), scope resolution — what's inside chapter X — and extraction-ready
block loading (scope), markdown→section splitting (sections), page provenance
(pages), the canonical bookmark outline (outline), figures/tables (elements), the
syllabus tree (toc_tree), chapter units (chapters), and math-markdown normalization
(math_markdown). Depends on: platform.
"""

from app.content.chapters import chapter_units
from app.content.documents import fetch_latest_document, find_by_source_hash, resolve_doc_id
from app.content.elements import fetch_elements, figure_path
from app.content.math_markdown import normalize_math_in_markdown, replacement_char_ratio
from app.content.scope import SectionExtractInput, load_section_blocks, scope_blocks, scope_section_keys
from app.content.sections import clean_heading_markup
from app.content.store import fetch_outline, fetch_section_content, persist_document
from app.content.toc_tree import get_toc_tree

__all__ = [
    "SectionExtractInput",
    "chapter_units",
    "clean_heading_markup",
    "fetch_elements",
    "fetch_latest_document",
    "fetch_outline",
    "fetch_section_content",
    "figure_path",
    "find_by_source_hash",
    "get_toc_tree",
    "load_section_blocks",
    "normalize_math_in_markdown",
    "persist_document",
    "replacement_char_ratio",
    "resolve_doc_id",
    "scope_blocks",
    "scope_section_keys",
]
