"""Extraction — the LLM generation passes over stored content.

Owns: concept extraction with its grounding gate and rename carry-over
(concepts_extract), concept reads + curation writes (concept_store), the post-run
critic eval gate (eval_gate), chapter skeletons + orient (skeleton), the assembled
reading briefing (guided_reading), and reading guides (reading_guide). Depends on:
process/content, gateways.
"""

from app.process.extraction.concept_store import (
    concept_count,
    concept_counts_by_doc,
    delete_concept,
    fetch_document_concepts,
    fetch_section_concepts,
    section_concept_rows,
    update_concept,
)
from app.process.extraction.concepts_extract import extract_concepts_document
from app.process.extraction.guided_reading import fetch_guided_reading
from app.process.extraction.eval_gate import eval_enabled, evaluate_extraction_sample
from app.process.extraction.reading_guide import author_guides_sync, fetch_reading_guide, guide_status
from app.process.extraction.skeleton import fetch_orient, fetch_skeleton, get_chapter_progress, record_skeleton_grade, refresh_orient, refresh_skeleton, update_stage

__all__ = [
    "author_guides_sync",
    "concept_count",
    "concept_counts_by_doc",
    "delete_concept",
    "eval_enabled",
    "evaluate_extraction_sample",
    "extract_concepts_document",
    "fetch_guided_reading",
    "fetch_document_concepts",
    "fetch_orient",
    "fetch_reading_guide",
    "fetch_section_concepts",
    "fetch_skeleton",
    "get_chapter_progress",
    "guide_status",
    "record_skeleton_grade",
    "refresh_orient",
    "refresh_skeleton",
    "section_concept_rows",
    "update_concept",
    "update_stage",
]
