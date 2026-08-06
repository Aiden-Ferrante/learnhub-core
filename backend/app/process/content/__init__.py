"""Content — the book itself, and the one scope resolver.

Persists a converted document into the raw_ tables — raw_documents (identity/stub +
status), raw_structure (the TOC as a self-referencing tree, reassembled into outline
entries on read), raw_content (the markdown blocks), raw_elements (figures/tables) —
and serves them back in the shapes the reader/API expect. Pages are metadata on the
structure/content rows; there is no page_content table.

Owns: the book/version split — ``sources`` is the uploaded PDF, ``raw_documents`` is a
course version over it and is what every doc_id refers to; anything reaching for the
uploaded material resolves through ``source_id_of`` first. Document metadata + the
latest-doc rule + stub/status + list/delete/overview (documents), persist + section reads + the outline/markdown reassembly (store), scope
resolution — what's inside chapter X — and extraction-ready block loading (scope),
markdown→section splitting (sections), page-range assignment (pages), the canonical
bookmark outline (outline), the staged TOC routing loop with its decision log
(toc_controller), figures/tables (elements), the syllabus tree (toc_tree),
chapter units + whole-chapter pulls (chapters), the version lifecycle —
create-from-Default / rename / set-main / delete (versions) — keyword search (find), and
math-markdown normalization (math_markdown). Depends on: gateways.
"""

from app.process.content.blocks import (
    blocks_sql,
    concept_filter,
    fetch_blocks,
    section_key_expr,
    source_sections,
    version_sections_by_source,
)
from app.process.content.chapters import chapter_key_of, chapter_units, fetch_chapter
from app.process.content.documents import (
    create_stub,
    delete_document,
    document_overview,
    fetch_latest_document,
    fetch_structure_entries,
    find_by_source_hash,
    list_documents,
    mark_document_status,
    resolve_doc_id,
    source_id_of,
    structure_id,
)
from app.process.content.elements import fetch_elements, figure_path
from app.process.content.find import keyword_search
from app.process.content.math_markdown import normalize_math_in_markdown, replacement_char_ratio
from app.process.content.scope import SectionExtractInput, load_section_blocks, scope_blocks, scope_section_keys
from app.process.content.sections import clean_heading_markup
from app.process.content.store import fetch_outline, fetch_section_content, persist_document
from app.process.content.toc_controller import TocResolution, resolve_toc
from app.process.content.toc_tree import get_toc_tree
from app.process.content.versions import (
    create_version,
    delete_version,
    list_versions,
    rename_version,
    set_main_version,
)

__all__ = [
    "concept_filter",
    "set_main_version",
    "rename_version",
    "list_versions",
    "delete_version",
    "create_version",
    "SectionExtractInput",
    "blocks_sql",
    "chapter_key_of",
    "chapter_units",
    "clean_heading_markup",
    "create_stub",
    "delete_document",
    "document_overview",
    "fetch_blocks",
    "fetch_chapter",
    "fetch_elements",
    "fetch_latest_document",
    "fetch_outline",
    "fetch_section_content",
    "fetch_structure_entries",
    "figure_path",
    "find_by_source_hash",
    "get_toc_tree",
    "keyword_search",
    "list_documents",
    "load_section_blocks",
    "mark_document_status",
    "normalize_math_in_markdown",
    "persist_document",
    "TocResolution",
    "replacement_char_ratio",
    "resolve_doc_id",
    "resolve_toc",
    "scope_blocks",
    "scope_section_keys",
    "section_key_expr",
    "source_id_of",
    "source_sections",
    "structure_id",
    "version_sections_by_source",
]
