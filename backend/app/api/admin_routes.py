"""Small admin/read endpoints that round out the REST surface for the learn-hub MCP server.

The MCP server (mcp/server.py) talks ONLY to this REST API — it holds no DB credentials.
These three routes fill the gaps the study UI never needed: list the processed courses, and
edit a concept / its quiz questions for curation. Everything else the MCP needs already exists
(outline, concepts, mastery, review queue, quiz, extract, prepare).
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse
from psycopg.types.json import Json

from app.content import fetch_outline
from app.platform import db

router = APIRouter()

DOCUMENTS = "documents"
CONCEPTS = "concepts"
SECTION_CONTENT = "section_content"
# Fields a curator may edit on a concept (everything else — provenance, keys — is read-only).
_EDITABLE = {"name", "signal", "source", "kind"}


@router.get("/api/documents")
def api_list_documents() -> JSONResponse:
    """List the processed courses (one per converted document). Returns the learnDocId each
    study/concept endpoint expects as ``doc``."""
    try:
        with db() as conn:
            rows = conn.execute(
                'SELECT key AS "docId", title, source_filename AS "sourceFilename", '
                'page_count AS "pageCount", section_count AS "sectionCount", '
                '(extract(epoch from created_at) * 1000)::bigint AS "createdAt" '
                "FROM documents ORDER BY created_at DESC NULLS LAST"
            ).fetchall()
            # Concept counts per doc, so the MCP can show which courses are extracted.
            counts = {
                r["docId"]: r["n"]
                for r in conn.execute(
                    'SELECT doc_id AS "docId", count(*) AS n FROM concepts GROUP BY doc_id'
                ).fetchall()
            }
        for r in rows:
            r["conceptCount"] = counts.get(r["docId"], 0)
        return JSONResponse({"documents": rows})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


def _resolve_chapter(tops: list[dict], ref: str) -> dict | None:
    """Resolve a chapter reference to its top-level outline entry. `ref` may be a chapter NUMBER
    ('3' → numberKey '3'), an exact sectionKey ('toc:3' / 'toc:preface'), or a title substring."""
    ref = (ref or "").strip()
    if not ref:
        return None
    low = ref.lower()
    # 1) exact numberKey (chapter number)
    for e in tops:
        if str(e.get("numberKey") or "").strip() == ref:
            return e
    # 2) exact sectionKey
    for e in tops:
        if (e.get("sectionKey") or "") == ref:
            return e
    # 3) title substring (first match in reading order)
    for e in tops:
        if low in (e.get("title") or "").lower():
            return e
    return None


@router.get("/api/chapter")
def api_chapter(
    doc: str | None = Query(None),
    ref: str = Query(..., description="chapter number, sectionKey, or title substring"),
    max_chars: int = Query(0, ge=0, description="optional cap on returned markdown (0 = no cap)"),
) -> JSONResponse:
    """Pull an ENTIRE chapter's text. Resolves `ref` against the document outline, then gathers
    every content block in that chapter's PAGE SPAN (start page → the next top-level entry's page)
    — robust to the outline/section_content key mismatch — and returns the concatenated markdown
    plus the chapter's sub-section list and an approximate token count."""
    try:
        data = fetch_outline(doc)
        if data.get("error"):
            return JSONResponse({"error": data["error"]}, status_code=503)
        outline = data.get("outline") or []
        resolved_doc = data.get("docId") or doc
        # Top-level entries sorted by page define the chapter boundaries.
        tops = sorted(
            [e for e in outline if (e.get("listDepth") or 0) == 0 and e.get("page") is not None],
            key=lambda e: e["page"],
        )
        if not tops:
            return JSONResponse({"error": "document has no paged outline"}, status_code=404)
        target = _resolve_chapter(tops, ref)
        if not target:
            return JSONResponse(
                {
                    "error": f"chapter '{ref}' not found",
                    "available": [
                        {"number": e.get("numberKey"), "title": e.get("title"),
                         "sectionKey": e.get("sectionKey"), "page": e.get("page")}
                        for e in tops
                    ],
                },
                status_code=404,
            )
        start = target["page"]
        # End = the page of the next top-level entry that starts strictly later (handles ties).
        later = [e["page"] for e in tops if e["page"] > start]
        end = min(later) if later else 10**9

        with db() as conn:
            blocks = conn.execute(
                'SELECT markdown, section_key AS "sectionKey", heading, '
                'page_start AS "pageStart", page_end AS "pageEnd" '
                f"FROM {SECTION_CONTENT} WHERE doc_id = %(d)s AND page_start IS NOT NULL "
                'AND page_start >= %(s)s AND page_start < %(e)s ORDER BY page_start ASC, "order" ASC',
                {"d": resolved_doc, "s": start, "e": end},
            ).fetchall()
        markdown = "\n\n".join(b.get("markdown") or "" for b in blocks if b.get("markdown")).strip()
        truncated = False
        if max_chars and len(markdown) > max_chars:
            markdown = markdown[:max_chars].rstrip()
            truncated = True
        subsections = [
            {"title": e.get("title"), "sectionKey": e.get("sectionKey"), "page": e.get("page")}
            for e in outline
            if (e.get("listDepth") or 0) > 0 and e.get("page") is not None and start <= e["page"] < end
        ]
        return JSONResponse(
            {
                "docId": resolved_doc,
                "ref": ref,
                "chapter": {
                    "number": target.get("numberKey"),
                    "title": target.get("title"),
                    "sectionKey": target.get("sectionKey"),
                    "pageStart": start,
                    "pageEnd": (end - 1) if end < 10**9 else (blocks[-1]["pageEnd"] if blocks else start),
                },
                "subsections": subsections,
                "blockCount": len(blocks),
                "charCount": len(markdown),
                "approxTokens": len(markdown) // 4,
                "truncated": truncated,
                "markdown": markdown,
            }
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


def _snippet(text: str, terms: list[str], width: int = 260) -> str:
    """A ~`width`-char window of `text` centred on the first matched term."""
    low = text.lower()
    pos = min((low.find(t) for t in terms if low.find(t) >= 0), default=-1)
    if pos < 0:
        return text[:width].strip()
    start = max(0, pos - width // 3)
    out = text[start : start + width].strip()
    return ("…" if start > 0 else "") + out + ("…" if start + width < len(text) else "")


@router.get("/api/search")
def api_search(
    doc: str | None = Query(None),
    q: str = Query(..., min_length=2, description="keywords to find in the course content"),
    limit: int = Query(8, ge=1, le=40),
    full: bool = Query(False, description="include each match's full block markdown"),
) -> JSONResponse:
    """Keyword-search a course's content. Returns the best-matching passages with their section,
    heading, page, score and a snippet — so you can locate a topic ('quantization') without
    knowing the chapter, then pull it with get_section / get_chapter."""
    terms = [t for t in "".join(c if c.isalnum() else " " for c in q.lower()).split() if len(t) > 1]
    if not terms:
        return JSONResponse({"query": q, "matches": []})
    try:
        with db() as conn:
            blocks = conn.execute(
                'SELECT section_key AS "sectionKey", heading, markdown, '
                'page_start AS "pageStart", page_end AS "pageEnd" '
                f"FROM {SECTION_CONTENT} WHERE markdown IS NOT NULL "
                "AND (%(d)s::text IS NULL OR doc_id = %(d)s)",
                {"d": doc},
            ).fetchall()
        scored = []
        for b in blocks:
            md = b.get("markdown") or ""
            low = md.lower()
            head = (b.get("heading") or "").lower()
            # Coverage (how many distinct query terms appear) dominates raw frequency, so a passage
            # mentioning every term beats one that just repeats a common word like "model".
            covered = sum(1 for t in terms if t in low or t in head)
            if covered == 0:
                continue
            freq = sum(low.count(t) for t in terms)
            head_hits = sum(t in head for t in terms)
            score = covered * 1000 + head_hits * 50 + freq
            scored.append((score, covered, b, md))
        scored.sort(key=lambda x: x[0], reverse=True)
        matches = [
            {
                "sectionKey": b.get("sectionKey"),
                "heading": b.get("heading"),
                "pageStart": b.get("pageStart"),
                "pageEnd": b.get("pageEnd"),
                "score": score,
                "termsMatched": f"{covered}/{len(terms)}",
                "snippet": _snippet(md, terms),
                **({"markdown": md} if full else {}),
            }
            for score, covered, b, md in scored[:limit]
        ]
        return JSONResponse({"query": q, "terms": terms, "total": len(scored), "matches": matches})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.patch("/api/concept/{key}")
def api_update_concept(key: str, body: dict = Body(...)) -> JSONResponse:
    """Edit a concept's curatable fields (name, signal, source, kind).
    Keys/provenance are immutable; review history is keyed by the concept ``_key`` (untouched)."""
    patch: dict[str, Any] = {k: v for k, v in (body or {}).items() if k in _EDITABLE}
    if not patch:
        return JSONResponse(
            {"error": f"no editable fields; allowed: {sorted(_EDITABLE)}"}, status_code=400
        )
    sets, params = [], {"key": key}
    for f, v in patch.items():
        sets.append(f'"{f}" = %({f})s')
        params[f] = v
    try:
        with db() as conn:
            row = conn.execute(
                f"UPDATE {CONCEPTS} SET {', '.join(sets)} WHERE key = %(key)s RETURNING key", params
            ).fetchone()
        if row is None:
            return JSONResponse({"error": f"concept {key} not found"}, status_code=404)
        return JSONResponse({"updated": key, "fields": sorted(patch)})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.delete("/api/concept/{key}")
def api_delete_concept(key: str) -> JSONResponse:
    """Curation: remove a junk concept plus its review history. The concept's
    section/document content is untouched — re-extracting the section will re-create
    the concept if the model still finds it."""
    try:
        with db() as conn:
            row = conn.execute(
                f"SELECT name FROM {CONCEPTS} WHERE key = %(k)s", {"k": key}
            ).fetchone()
            if row is None:
                return JSONResponse({"error": f"concept {key} not found"}, status_code=404)
            removed: dict[str, Any] = {"concept": row.get("name")}
            # Review schedule is one row per concept, keyed by the concept key.
            removed["reviews"] = conn.execute(
                "DELETE FROM concept_reviews WHERE key = %(k)s", {"k": key}
            ).rowcount
            conn.execute(f"DELETE FROM {CONCEPTS} WHERE key = %(k)s", {"k": key})
        return JSONResponse({"deleted": key, **removed})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


# Learn-content tables that carry a per-document field.
_DOC_CASCADE: tuple[tuple[str, str], ...] = (
    ("section_content", "doc_id"),
    ("page_content", "doc_id"),
    ("elements", "doc_id"),
    ("content_vectors", "doc_id"),
    ("concepts", "doc_id"),
    ("concept_reviews", "doc_id"),
    ("study_events", "doc"),
    ("chapter_builds", "doc_id"),
    ("chapter_skeletons", "doc_id"),
    ("chapter_orient", "doc_id"),
    ("chapter_progress", "doc_id"),
    ("deep_chapter_briefing", "doc_id"),
    ("reading_guides", "doc_id"),
    ("section_augment", "doc_id"),
)


@router.delete("/api/document")
def api_delete_document(doc: str = Query(...)) -> JSONResponse:
    """Delete a course outright: the document row, every learn collection keyed by it, and
    its on-disk artifacts (original PDF + figures). Irreversible."""
    if not re.fullmatch(r"[0-9a-fA-F-]{8,64}", doc or ""):
        return JSONResponse({"error": "invalid doc id"}, status_code=400)
    try:
        with db() as conn:
            existed = conn.execute(
                f"SELECT 1 FROM {DOCUMENTS} WHERE key = %(d)s", {"d": doc}
            ).fetchone() is not None
            removed: dict[str, int] = {}
            for coll, field in _DOC_CASCADE:
                try:
                    n = conn.execute(
                        f"DELETE FROM {coll} WHERE {field} = %(d)s", {"d": doc}
                    ).rowcount
                except Exception:  # noqa: BLE001 — table may not exist in this schema
                    continue
                if n:
                    removed[coll] = n
            if existed:
                conn.execute(f"DELETE FROM {DOCUMENTS} WHERE key = %(d)s", {"d": doc})
        shared = Path(os.environ.get("SHARED_DIR", "/shared"))
        for sub in ("ingest", "figures"):
            target = shared / sub / doc
            if target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
        if not existed and not removed:
            return JSONResponse({"error": f"document {doc} not found"}, status_code=404)
        return JSONResponse({"deleted": doc, "removed": removed})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


# Sections map to their chapter by number prefix ("toc:2.1" -> "toc:2"); slug keys are
# their own chapter. Mirrors the outline's listDepth-0 topology.
_CHAPTER_OF = re.compile(r"^toc:(\d+)(?:\.\d+)*(?:~\d+)?$")


def chapter_key_of(section_key: str) -> str:
    m = _CHAPTER_OF.match(section_key or "")
    return f"toc:{m.group(1)}" if m else (section_key or "")


@router.get("/api/course-status")
def api_course_status(doc: str = Query(...)) -> JSONResponse:
    """One pipeline status for a course: does the content exist, is there an outline, and
    how far concept/quiz coverage has progressed per chapter. Drives the UI status strip
    and reason-aware empty states (exists=false -> broken content link)."""
    try:
        with db() as conn:
            row = conn.execute(
                "SELECT title, outline, page_count AS \"pageCount\", "
                'section_count AS "sectionCount" FROM documents WHERE key = %(d)s',
                {"d": doc},
            ).fetchone()
            if row is None:
                return JSONResponse(
                    {"doc": doc, "exists": False, "reason": "doc-not-found"}, status_code=404
                )
            concept_rows = conn.execute(
                'SELECT section_key AS s, COALESCE(jsonb_array_length(quiz_questions), 0) AS q '
                "FROM concepts WHERE doc_id = %(d)s",
                {"d": doc},
            ).fetchall()
        outline = row.get("outline") or []
        top = [e for e in outline if (e.get("listDepth") or 0) == 0]
        # Numbered chapters are the study surface; front/back matter (Title Page, Index…)
        # never gets concepts and would make the coverage denominator unreachable. Books
        # without numbered chapters (slug outlines) fall back to all top-level entries.
        numbered = [e for e in top if e.get("numberKey")]
        chapters = numbered or top
        chapter_keys = {e.get("sectionKey") for e in chapters if e.get("sectionKey")}

        with_concepts: set[str] = set()
        with_quizzes: set[str] = set()
        for c in concept_rows:
            ck = chapter_key_of(c.get("s") or "")
            if ck in chapter_keys:
                with_concepts.add(ck)
                if c.get("q"):
                    with_quizzes.add(ck)
        return JSONResponse(
            {
                "doc": doc,
                "exists": True,
                "title": row.get("title"),
                "converted": True,
                "pageCount": row.get("pageCount"),
                "sectionCount": row.get("sectionCount"),
                "outlineEntries": len(outline),
                "chaptersTotal": len(chapter_keys),
                "chaptersWithConcepts": len(with_concepts),
                "chaptersWithQuizzes": len(with_quizzes),
                "conceptCount": len(concept_rows),
            }
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.get("/api/study-debt")
def api_study_debt(days: int = Query(7)) -> JSONResponse:
    """Cross-course review debt for external surfaces (the morning vault briefing).
    Everything else here is per-doc; this is the one whole-library rollup: what's due NOW
    and what fades within ``days``, per course and in total."""
    import time as _time

    try:
        now = int(_time.time())
        horizon = now + max(1, days) * 86400
        with db() as conn:
            titles = {
                r["k"]: r["t"]
                for r in conn.execute('SELECT key AS k, title AS t FROM documents').fetchall()
            }
            rows = conn.execute(
                "SELECT doc_id AS d, "
                "SUM(CASE WHEN due <= to_timestamp(%(now)s) THEN 1 ELSE 0 END) AS due, "
                "SUM(CASE WHEN due > to_timestamp(%(now)s) AND due <= to_timestamp(%(hz)s) "
                "THEN 1 ELSE 0 END) AS soon, "
                "COUNT(*) AS tracked "
                "FROM concept_reviews WHERE due IS NOT NULL GROUP BY doc_id",
                {"now": now, "hz": horizon},
            ).fetchall()
        courses = [
            {
                "doc": r["d"],
                "title": titles.get(r["d"]) or r["d"],
                "dueNow": int(r["due"] or 0),
                "fadingSoon": int(r["soon"] or 0),
                "tracked": int(r["tracked"] or 0),
            }
            for r in rows
            if r.get("d") in titles  # skip reviews orphaned by deleted courses
        ]
        courses.sort(key=lambda c: (-c["dueNow"], -c["fadingSoon"]))
        return JSONResponse(
            {
                "dueNow": sum(c["dueNow"] for c in courses),
                "fadingSoon": sum(c["fadingSoon"] for c in courses),
                "tracked": sum(c["tracked"] for c in courses),
                "days": days,
                "courses": courses,
            }
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.put("/api/concept/{key}/questions")
def api_set_concept_questions(key: str, body: dict = Body(...)) -> JSONResponse:
    """Replace a concept's cached quiz questions (``quizQuestions``). Pass ``{"questions": [...]}``
    to set, or ``{"questions": []}`` / ``null`` to clear so it re-authors on next study."""
    qs = (body or {}).get("questions")
    if qs is not None and not isinstance(qs, list):
        return JSONResponse({"error": "questions must be a list or null"}, status_code=400)
    try:
        with db() as conn:
            row = conn.execute(
                f"UPDATE {CONCEPTS} SET quiz_questions = %(q)s WHERE key = %(k)s RETURNING key",
                {"q": Json(qs) if qs else None, "k": key},
            ).fetchone()
        if row is None:
            return JSONResponse({"error": f"concept {key} not found"}, status_code=404)
        return JSONResponse({"updated": key, "quizQuestions": len(qs) if qs else 0})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
