"""Pydantic models for the LLM structured-output call sites.

One model per structured generation site, mirroring the original ``*_JSON_SCHEMA`` dicts
exactly (same field names, same required/optional split). They are passed to
``llm.ollama_structured_completion`` / ``ChatOllama.with_structured_output(..., method="json_schema")``,
which constrains Ollama to emit matching JSON. The wrapper ``model_dump``s the result back to
a plain dict so every downstream parser sees the identical keys it did before.

Field names are intentionally kept as-is (including camelCase ``answerIndex`` / ``watchFor``)
so no aliasing is required — ``model_dump()`` reproduces the original wire keys 1:1.

The ``Literal`` enums mirror ``concepts_extract._KINDS`` and ``concept_quiz_llm._TYPES``;
kept inline here (rather than imported) to avoid a circular import, since those modules
consume these models.
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
# concept_quiz_llm.py — AUTHOR_SCHEMA  (author + critic; mirrors _TYPES)
# --------------------------------------------------------------------------- #

QuestionType = Literal["apply", "distinguish", "why"]


class AuthoredQuestion(BaseModel):
    type: QuestionType
    stem: str
    options: List[str]
    answerIndex: int
    explanation: str


class AuthoredSet(BaseModel):
    questions: List[AuthoredQuestion]


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
# audiobook.py — GUIDED_SCHEMA  (comments optional: required = intro + takeaways)
# --------------------------------------------------------------------------- #


class GuidedComment(BaseModel):
    after: int
    note: str


class GuidedScript(BaseModel):
    intro: str
    comments: List[GuidedComment] = Field(default_factory=list)
    takeaways: List[str]


# --------------------------------------------------------------------------- #
# extraction/eval_gate.py — the extraction-quality critic verdict
# --------------------------------------------------------------------------- #

class ConceptVerdict(BaseModel):
    """Critic verdict for one extracted concept (all three must hold to pass)."""

    grounded: bool = Field(description="every claim in signal is stated in source_sentence")
    informative: bool = Field(description="signal explains the concept, not merely restates its name")
    durable: bool = Field(description="a teachable general concept, not a one-off fact/statistic/opinion")
    reason: str = Field(description="one short sentence justifying the weakest judgment")
