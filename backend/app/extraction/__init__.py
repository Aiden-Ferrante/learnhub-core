"""Extraction — the LLM generation passes over stored content.

Owns: concept extraction with its grounding gate and rename carry-over
(concepts_extract), concept reads (concept_store), the post-run critic eval gate
(eval_gate), chapter skeletons + orient (skeleton), the assembled reading briefing
(guided_reading), reading guides (reading_guide), and section objectives/recaps
(augment). Depends on: content, search (index refresh), platform.
"""

from app.extraction.augment import section_augment
from app.extraction.concept_store import concept_count, fetch_document_concepts, fetch_section_concepts
from app.extraction.concepts_extract import extract_concepts_document
from app.extraction.guided_reading import briefing_key, fetch_guided_reading, prepare_guided_reading
from app.extraction.eval_gate import eval_enabled, evaluate_extraction_sample
from app.extraction.reading_guide import author_guides_sync, fetch_reading_guide, guide_status
from app.extraction.skeleton import SKELETON_PROMPT_VERSION, chapter_cache_key, fetch_orient, fetch_skeleton, get_chapter_progress, record_skeleton_grade, refresh_orient, refresh_skeleton, update_stage

__all__ = [
    "SKELETON_PROMPT_VERSION",
    "author_guides_sync",
    "briefing_key",
    "chapter_cache_key",
    "concept_count",
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
    "prepare_guided_reading",
    "record_skeleton_grade",
    "refresh_orient",
    "refresh_skeleton",
    "section_augment",
    "update_stage",
]
