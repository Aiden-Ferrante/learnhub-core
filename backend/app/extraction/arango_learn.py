"""AQL helpers over the legacy triple KG — the /api/deck flashcards (MCP) and the
triple branch of mastery still read it. The quiz/exam/Socratic consumers were removed
with the triple pipeline."""

from __future__ import annotations

import hashlib
import os
from typing import Any

from arango.exceptions import ArangoError

from app.content.arango_tree import (
    HIERARCHY_PREDICATE,
    MENTIONS_PREDICATE,
    fetch_section_mentions_by_section,
)
from app.platform.arango import connect_arango

DEFAULT_SKIP_PREDICATES = (HIERARCHY_PREDICATE, MENTIONS_PREDICATE)
MAX_EDGES_SECTION = 200
MAX_EDGES_SAMPLE = 400

# --- Read-time noise filter --------------------------------------------------
# Automatic extraction over running prose produces triples that are syntactically
# valid but useless to *study* from: pronoun/deictic subjects ("we", "this
# chapter"), page-number/layout artifacts, and bibliographic citations. They make
# flashcards like "Subject: we — what predicate relates this to «...»?" and pad
# quizzes with un-answerable noise. We drop them at the single chokepoint every
# triple query passes through, so decks, quizzes, section-stats and the Socratic
# tutor all see the cleaned set. Disable with LEARN_FILTER_NOISE=0 to A/B.
FILTER_NOISE = os.getenv("LEARN_FILTER_NOISE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "",
)

# Bare pronouns / deictic references — never standalone knowledge as a triple end.
_PRONOUN_ENDPOINTS = frozenset(
    {
        "we", "i", "it", "they", "there", "this", "that", "he", "she", "you",
        "these", "those", "one", "them", "us",
        "this chapter", "this section", "this book", "the chapter", "the section",
        "the book", "the author", "the authors", "the following",
    }
)

# Predicate marks bibliographic / page-layout noise rather than real knowledge.
_NOISE_PREDICATE_SUBSTRINGS = ("page number",)


def _is_noise_triple(s: str, p: str, o: str) -> bool:
    """True when a triple is an extraction artifact, not studyable knowledge."""
    if s.lower() in _PRONOUN_ENDPOINTS or o.lower() in _PRONOUN_ENDPOINTS:
        return True
    pl = p.lower().replace("_", " ")
    if any(sub in pl for sub in _NOISE_PREDICATE_SUBSTRINGS):
        return True
    # Bibliographic citations: "published", "published in", "published_in".
    if pl.startswith("publish"):
        return True
    return False


def _triple_rows_from_cursor(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for r in rows:
        s = (r.get("subject") or "").strip()
        p = (r.get("predicate") or "").strip()
        o = (r.get("object") or "").strip()
        if not (s and p and o):
            continue
        if FILTER_NOISE and _is_noise_triple(s, p, o):
            continue
        out.append({"subject": s, "predicate": p, "object": o})
    return out


def sample_triples(
    limit: int = 50,
    skip_predicates: tuple[str, ...] | None = DEFAULT_SKIP_PREDICATES,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Random triples from relationships (structural predicates skipped by default)."""
    db = connect_arango()
    skip = list(skip_predicates or ())
    aql = """
    FOR edge IN relationships
      FILTER @doc == null OR @doc IN NOT_NULL(edge.docIds, [])
      FILTER LENGTH(@skip) == 0 OR edge.type NOT IN @skip
      LET s = DOCUMENT(edge._from)
      LET t = DOCUMENT(edge._to)
      FILTER s != null AND t != null
      SORT RAND()
      LIMIT @limit
      RETURN { subject: s.name, predicate: edge.type, object: t.name }
    """
    cur = db.aql.execute(
        aql, bind_vars={"limit": min(limit, MAX_EDGES_SAMPLE), "skip": skip, "doc": doc}
    )
    return _triple_rows_from_cursor(list(cur))


def triples_for_section(
    section_name: str,
    limit: int = MAX_EDGES_SECTION,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Edges touching the section entity, capped (includes structural + content)."""
    db = connect_arango()
    aql = """
    FOR v IN entities
      FILTER v.name == @section
      LIMIT 1
      FOR edge IN relationships
        FILTER edge._from == v._id OR edge._to == v._id
        FILTER @doc == null OR @doc IN NOT_NULL(edge.docIds, [])
        LIMIT @limit
        LET s = DOCUMENT(edge._from)
        LET t = DOCUMENT(edge._to)
        FILTER s != null AND t != null
        RETURN { subject: s.name, predicate: edge.type, object: t.name }
    """
    cur = db.aql.execute(
        aql,
        bind_vars={"section": section_name, "limit": min(limit, MAX_EDGES_SECTION), "doc": doc},
    )
    return _triple_rows_from_cursor(list(cur))


def content_triples_for_section(
    section_name: str,
    limit: int = MAX_EDGES_SECTION,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Content triples whose subject OR object is an entity mentioned in the section.

    Unlike ``triples_for_section`` (which returns edges touching the TOC node itself,
    mostly structural), this resolves the section's ``section_mentions`` entities and
    fetches real content triples among them — the actual knowledge to test.
    """
    db = connect_arango()
    mentions = fetch_section_mentions_by_section(db, doc)
    names = mentions.get(section_name.strip(), [])
    if not names:
        return []
    aql = """
    FOR edge IN relationships
      FILTER @doc == null OR @doc IN NOT_NULL(edge.docIds, [])
      FILTER edge.type NOT IN @skip
      LET s = DOCUMENT(edge._from)
      LET t = DOCUMENT(edge._to)
      FILTER s != null AND t != null
      FILTER s.name IN @names OR t.name IN @names
      LIMIT @limit
      RETURN { subject: s.name, predicate: edge.type, object: t.name }
    """
    cur = db.aql.execute(
        aql,
        bind_vars={
            "names": names,
            "skip": list(DEFAULT_SKIP_PREDICATES),
            "limit": min(limit, MAX_EDGES_SECTION),
            "doc": doc,
        },
    )
    return _triple_rows_from_cursor(list(cur))


def triples_for_study_scope(
    scope: str | None,
    limit: int = 50,
    include_structural: bool = False,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Triples for a TOC section name, or global random sample.

    For a section scope we want the *content* triples among the entities the
    section mentions. Edges touching the TOC node itself are purely structural
    (``has_subsection`` / ``section_mentions``), so the old query — fetch those
    edges, then drop structural predicates — left ~0 triples for every section.
    That made the section panel show "0 triples / 0 entities", left flashcard
    decks empty, and starved the Socratic tutor of context, even though the
    quiz worked (it already used the content path). Mirror that path here:
    resolve content triples first, and fall back to the TOC-node edges only
    when there are none, or when structural triples are explicitly requested.
    """
    skip: tuple[str, ...] = () if include_structural else DEFAULT_SKIP_PREDICATES
    if scope and scope.strip():
        if not include_structural:
            content = content_triples_for_section(
                scope.strip(), limit=max(limit, MAX_EDGES_SECTION), doc=doc
            )
            if content:
                return content[:limit] if len(content) > limit else content
        rows = triples_for_section(scope.strip(), limit=max(limit, 200), doc=doc)
        if not include_structural:
            rows = [r for r in rows if r["predicate"] not in DEFAULT_SKIP_PREDICATES]
        return rows[:limit] if len(rows) > limit else rows
    return sample_triples(limit=limit, skip_predicates=skip if skip else (), doc=doc)


def triple_line(t: dict[str, str]) -> str:
    return f'{t["subject"]} | {t["predicate"]} | {t["object"]}'


def triple_id(t: dict[str, str]) -> str:
    return hashlib.sha256(triple_line(t).encode()).hexdigest()[:16]


def fetch_triples_or_error(
    scope: str | None, limit: int, include_structural: bool, doc: str | None = None
) -> tuple[list[dict[str, str]], str | None]:
    try:
        return (
            triples_for_study_scope(
                scope, limit=limit, include_structural=include_structural, doc=doc
            ),
            None,
        )
    except ArangoError as e:
        return [], str(e)
    except Exception as e:
        return [], str(e)
