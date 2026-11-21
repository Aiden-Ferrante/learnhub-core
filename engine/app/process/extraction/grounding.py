"""Does a concept's source_sentence actually appear in the section it came from?

The extraction gate (`concepts_extract._REQUIRE_SOURCE`) drops a concept whose
``source_sentence`` is *empty*. It has never checked that the sentence is *real* — a model
inventing a plausible quote passes it cleanly. This module does the checking.

It **classifies** rather than passing or failing, because "how did it fail" is the useful
answer and the two ways differ completely:

``verbatim``       the quote appears in the section, normalized
``partial``        one full sentence of a multi-sentence quote appears
``near-verbatim``  a long contiguous run survives but the string does not match — ENCODING
                   damage (see `concepts_extract.repair_model_text`), not a grounding failure
``paraphrase``     every word is present but the run is short: the model rewrote, not copied
``elsewhere``      the quote is real but belongs to a DIFFERENT section — an attribution bug
``invented``       not in the section in any recognisable form
``ungated``        an empty source that reached the table anyway — the gate itself leaked

Only ``elsewhere``, ``invented`` and ``ungated`` mean the gate failed. Encoding damage must
not turn this red, or the signal is lost inside a failure nobody can act on.

Normalization is deliberately lossy: the question is whether the model COPIED the sentence,
not whether the markdown round-tripped byte-for-byte. Conflating the two is what made the
first run of this measurement hard to read.
"""

from __future__ import annotations

import difflib
import re
import unicodedata

__all__ = ["normalize", "classify_grounding", "summarize_grounding",
           "GATE_FAILURES", "VERDICTS"]

VERDICTS = ("verbatim", "partial", "near-verbatim", "paraphrase",
            "elsewhere", "invented", "ungated", "no-section-text")
# The verdicts that mean the extraction gate did not do its job.
GATE_FAILURES = ("invented", "elsewhere", "ungated")

_WORD = re.compile(r"[^a-z0-9]+")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_MIN_SENTENCE_WORDS = 4
_PARAPHRASE_FLOOR = 0.60
_PROBE_WORDS = 40


def normalize(s: str | None) -> str:
    """Fold to comparable text: NFKD, smart quotes and dashes, then alphanumerics only."""
    s = unicodedata.normalize("NFKD", s or "")
    for a, b in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"'),
                 ("—", " "), ("–", " "), ("−", "-")):
        s = s.replace(a, b)
    return " ".join(_WORD.sub(" ", s.lower()).split())


def classify_grounding(source: str | None, section_md: str | None, book_md: str | None = "") -> str:
    """One concept's verdict. ``book_md`` enables the ``elsewhere`` check; pass "" to skip."""
    n_src, n_md = normalize(source), normalize(section_md)
    if not n_src:
        return "ungated"
    if not n_md:
        return "no-section-text"
    if n_src in n_md:
        return "verbatim"
    parts = [normalize(p) for p in _SENTENCE.split(source or "")
             if len(normalize(p).split()) >= _MIN_SENTENCE_WORDS]
    if parts and any(p in n_md for p in parts):
        return "partial"
    words = n_src.split()
    probe = " ".join(words[:_PROBE_WORDS])
    if probe and probe in normalize(book_md):
        return "elsewhere"
    run = max((b.size for b in difflib.SequenceMatcher(
        None, words, n_md.split(), autojunk=False).get_matching_blocks()), default=0)
    if run >= max(5, len(words) // 3):
        return "near-verbatim"
    present = sum(1 for w in set(words) if w in n_md) / len(set(words))
    return "paraphrase" if present >= _PARAPHRASE_FLOOR else "invented"


def summarize_grounding(verdicts: list[str]) -> dict[str, object]:
    """Counts plus the one number that matters, and whether the gate held.

    ``examined == 0`` is reported as ``ok=False``. An empty corpus is absent information,
    not a pass — the same rule the study surfaces follow, and the whole reason this check
    exists rather than a row count.
    """
    counts: dict[str, int] = {}
    for v in verdicts:
        counts[v] = counts.get(v, 0) + 1
    examined = len(verdicts)
    failures = sum(counts.get(k, 0) for k in GATE_FAILURES)
    traced = examined - failures - counts.get("no-section-text", 0)
    return {
        "examined": examined,
        "counts": counts,
        "failures": failures,
        "traced": traced,
        "ok": examined > 0 and failures == 0,
    }
