"""Quiz-target quality helpers shared by the concept quiz + chapter exam.

LLM-authored understanding questions live in ``concept_quiz_llm`` (cached on
``concepts.quizQuestions``) — that is the high-quality path. This module improves
the choice of WHAT to quiz:

- A2 (`is_quizzable`): drop fact-shaped / sentence-length "concepts" so trivia isn't quizzed.
"""

from __future__ import annotations

from typing import Any


CONCEPTS = "concepts"

# Names that signal a one-off fact/observation rather than a durable, teachable concept.
_FACT_MARKERS = ("popularity", "funding", "number of", "amount of", "percentage", "statistics")


def is_quizzable(c: dict[str, Any]) -> bool:
    """A concept worth a question: a substantive explanation, a crisp (not sentence-length) name,
    and not an obvious one-off fact/statistic. Filters the trivia that makes mechanical MCQs
    circular ('which concept does <fact> describe?' → the fact's own name)."""
    name = (c.get("name") or "").strip()
    signal = (c.get("signal") or "").strip()
    if len(signal) < 30 or not name:
        return False
    if len(name.split()) > 6:  # a descriptive phrase, not a canonical term
        return False
    if any(m in name.lower() for m in _FACT_MARKERS):
        return False
    return True
