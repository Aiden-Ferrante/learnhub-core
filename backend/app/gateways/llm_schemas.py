"""Pydantic models for the LLM structured-output call sites.

One model per structured generation site, mirroring the original ``*_JSON_SCHEMA`` dicts
exactly (same field names, same required/optional split). They are passed to
``llm.ollama_structured_completion`` / ``ChatOllama.with_structured_output(..., method="json_schema")``,
which constrains Ollama to emit matching JSON. The wrapper ``model_dump``s the result back to
a plain dict so every downstream parser sees the identical keys it did before.

Field names are intentionally kept as-is (including camelCase ``answerIndex`` / ``watchFor``)
so no aliasing is required — ``model_dump()`` reproduces the original wire keys 1:1.

The ``Literal`` enums mirror ``concepts_extract._KINDS``; kept inline here (rather than
imported) to avoid a circular import, since that module consumes these models.
"""

from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# concepts_extract.py — CONCEPT_JSON_SCHEMA  (mirrors _KINDS)
# --------------------------------------------------------------------------- #

ConceptKind = Literal["definition", "theorem", "principle", "result", "method"]


class ConceptItem(BaseModel):
    name: str
    kind: ConceptKind
    signal: str
    source_sentence: str


class ConceptResult(BaseModel):
    concepts: List[ConceptItem]


# --------------------------------------------------------------------------- #
# reading_guide.py — AUTHOR_SCHEMA
# --------------------------------------------------------------------------- #


class Check(BaseModel):
    q: str
    a: str


class ReadingGuide(BaseModel):
    focus: str
    checks: List[Check]


# --------------------------------------------------------------------------- #
# practice.py — the practice-item authors (one model per item kind's schema)
# --------------------------------------------------------------------------- #


class RetrieveItem(BaseModel):
    """A knowledge-retrieval question with its model answer (kind='retrieve')."""

    q: str
    a: str
    # 1 = applies one definition or rule directly · 2 = combines several steps or two
    # ideas · 3 = constructs, proves, or is multi-part (v0.23.0). Validated 1–3 at
    # post-processing; anything else is stored as unrated, never coerced.
    difficulty: int


class RetrieveSet(BaseModel):
    questions: List[RetrieveItem]


class ProblemItem(BaseModel):
    """A worked problem (kind='problem'): task → worked solution → self-grade rubric.
    Validated by the v0.19.0 step-2 spike (scripts/spike_problem_items.py)."""

    prompt: str
    answer: str
    rubric: str
    difficulty: int


class ProblemSet(BaseModel):
    problems: List[ProblemItem]


# --------------------------------------------------------------------------- #
# skeleton.py — SKELETON_SCHEMA / ORIENT_SCHEMA
# --------------------------------------------------------------------------- #


class SkeletonSection(BaseModel):
    heading: str
    essence: str


class Skeleton(BaseModel):
    sections: List[SkeletonSection]


class Orient(BaseModel):
    objectives: List[str]
    watchFor: List[str]




# --------------------------------------------------------------------------- #
# extraction/eval_gate.py — the extraction-quality critic verdict
# --------------------------------------------------------------------------- #

class ConceptVerdict(BaseModel):
    """Critic verdict for one extracted concept (all three must hold to pass)."""

    grounded: bool = Field(description="every claim in signal is stated in source_sentence")
    informative: bool = Field(description="signal explains the concept, not merely restates its name")
    durable: bool = Field(description="a teachable general concept, not a one-off fact/statistic/opinion")
    reason: str = Field(description="one short sentence justifying the weakest judgment")
