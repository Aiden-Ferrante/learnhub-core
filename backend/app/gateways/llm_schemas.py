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
# practice_checks.py — authoring-time quality stages (v0.23.0). Generation is LLM;
# grading is not: none of these is ever read by the graded loop.
# --------------------------------------------------------------------------- #


class Objective(BaseModel):
    """One thing a section teaches. ``recall`` = state, define, distinguish (→ retrieve
    items); ``produce`` = derive, apply, construct, decide (→ problem items)."""

    text: str
    level: Literal["recall", "produce"]


class ObjectiveSet(BaseModel):
    objectives: List[Objective]


class Attempt(BaseModel):
    """A fresh answer to item ``index``, written without seeing the stored answer."""

    index: int
    answer: str


class AttemptSet(BaseModel):
    attempts: List[Attempt]


class AnswerVerdict(BaseModel):
    """Does the fresh attempt agree with the stored answer on what matters?"""

    index: int
    verdict: Literal["consistent", "contradicts", "unanswerable", "gives_away"]
    reason: str


class AnswerVerdictSet(BaseModel):
    verdicts: List[AnswerVerdict]


class RecallVerdict(BaseModel):
    """Is this 'problem' only a definition restated — the Competency falsifier?"""

    index: int
    restates: bool
    reason: str


class RecallVerdictSet(BaseModel):
    verdicts: List[RecallVerdict]


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


# --------------------------------------------------------------------------- #
# process/packs/author.py: exam-pack authoring. Every item names the section it came
# from and quotes that section, which the build verifies against the stored text.
# --------------------------------------------------------------------------- #


class PackPoint(BaseModel):
    text: str
    sectionKey: str
    evidence: str


class PackChunk(BaseModel):
    points: List[PackPoint]


class PackSkill(BaseModel):
    id: str
    label: str
    sectionKey: str
    style: Literal["computable", "conceptual"]
    weight: float = 1.0
    evidence: str


class PackSkillSet(BaseModel):
    skills: List[PackSkill]


class PackBookProblem(BaseModel):
    skillId: str
    sectionKey: str
    stem: str
    choices: List[str] = Field(default_factory=list)
    answerIndex: int = -1
    printedAnswer: str = ""
    code: str = ""
    evidence: str


class PackBookProblemSet(BaseModel):
    problems: List[PackBookProblem]


class PackStep(BaseModel):
    ask: str
    show: str = ""
    code: str = ""


class PackWorked(BaseModel):
    skillId: str
    sectionKey: str
    stem: str
    steps: List[PackStep]
    answer: str
    evidence: str


class PackWorkedSet(BaseModel):
    worked: List[PackWorked]


class PackParam(BaseModel):
    name: str
    kind: Literal["int", "choice"]
    min: int = 0
    max: int = 0
    values: List[str] = Field(default_factory=list)


class PackDistractor(BaseModel):
    misconception: str
    code: str


class PackGenerator(BaseModel):
    skillId: str
    sectionKey: str
    params: List[PackParam]
    stem: str
    code: str
    distractors: List[PackDistractor]
    explain: str
    steps: List[PackStep]
    evidence: str
    basedOnBookProblem: bool = False


class PackGeneratorSet(BaseModel):
    generators: List[PackGenerator]


class PackMcq(BaseModel):
    skillId: str
    sectionKey: str
    stem: str
    choices: List[str]
    answerIndex: int
    explain: str
    evidence: str


class PackWritten(BaseModel):
    skillId: str
    sectionKey: str
    stem: str
    answer: str
    rubric: str
    evidence: str


class PackConceptSet(BaseModel):
    mcqs: List[PackMcq]
    written: List[PackWritten]


class PackVerdict(BaseModel):
    index: int
    keep: bool
    reason: str


class PackVerdictSet(BaseModel):
    verdicts: List[PackVerdict]
