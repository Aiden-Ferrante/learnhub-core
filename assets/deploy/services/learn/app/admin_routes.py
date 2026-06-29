"""Small admin/read endpoints that round out the REST surface for the learn-hub MCP server.

The MCP server (txt2kg/mcp/server.py) talks ONLY to this REST API — it holds no DB credentials.
These three routes fill the gaps the study UI never needed: list the processed courses, and
edit a concept / its quiz questions for curation. Everything else the MCP needs already exists
(outline, concepts, mastery, review queue, quiz, extract, prepare).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.arango_content import fetch_outline
from app.arango_tree import connect_arango

router = APIRouter()

DOCUMENTS = "documents"
CONCEPTS = "concepts"
SECTION_CONTENT = "section_content"
# Fields a curator may edit on a concept (everything else — provenance, keys — is read-only).
_EDITABLE = {"name", "signal", "source", "kind", "prereqNames", "questions"}


@router.get("/api/documents")
def api_list_documents() -> JSONResponse:
    """List the processed courses (one per converted document). Returns the learnDocId each
    study/concept endpoint expects as ``doc``."""
    try:
        db = connect_arango()
        if not db.has_collection(DOCUMENTS):
            return JSONResponse({"documents": []})
        rows = list(
            db.aql.execute(
                "FOR d IN documents SORT d.createdAt DESC RETURN {"
                "docId: d._key, title: d.title, sourceFilename: d.sourceFilename, "
                "pageCount: d.pageCount, sectionCount: d.sectionCount, createdAt: d.createdAt}"
            )
        )
        # Concept counts per doc, so the MCP can show which courses are extracted.
        counts = {
            r["docId"]: r["n"]
            for r in db.aql.execute(
                "FOR c IN concepts COLLECT d = c.docId WITH COUNT INTO n RETURN {docId: d, n: n}"
            )
        } if db.has_collection(CONCEPTS) else {}
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

        db = connect_arango()
        blocks = list(
            db.aql.execute(
                f"FOR b IN {SECTION_CONTENT} FILTER b.docId == @d AND b.pageStart != null "
                "AND b.pageStart >= @s AND b.pageStart < @e SORT b.pageStart ASC, b.order ASC "
                "RETURN {markdown: b.markdown, sectionKey: b.sectionKey, heading: b.heading, "
                "pageStart: b.pageStart, pageEnd: b.pageEnd}",
                bind_vars={"d": resolved_doc, "s": start, "e": end},
            )
        )
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
        db = connect_arango()
        blocks = list(
            db.aql.execute(
                f"FOR b IN {SECTION_CONTENT} FILTER b.docId == @d AND b.markdown != null "
                "RETURN {sectionKey: b.sectionKey, heading: b.heading, markdown: b.markdown, "
                "pageStart: b.pageStart, pageEnd: b.pageEnd}",
                bind_vars={"d": doc} if doc else {"d": None},
            )
            if doc
            else db.aql.execute(
                f"FOR b IN {SECTION_CONTENT} FILTER b.markdown != null "
                "RETURN {sectionKey: b.sectionKey, heading: b.heading, markdown: b.markdown, "
                "pageStart: b.pageStart, pageEnd: b.pageEnd}"
            )
        )
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
    """Edit a concept's curatable fields (name, signal, source, kind, prereqNames, questions).
    Keys/provenance are immutable; review history is keyed by the concept ``_key`` (untouched)."""
    patch: dict[str, Any] = {k: v for k, v in (body or {}).items() if k in _EDITABLE}
    if not patch:
        return JSONResponse(
            {"error": f"no editable fields; allowed: {sorted(_EDITABLE)}"}, status_code=400
        )
    try:
        db = connect_arango()
        col = db.collection(CONCEPTS)
        if not col.has(key):
            return JSONResponse({"error": f"concept {key} not found"}, status_code=404)
        col.update({"_key": key, **patch})
        return JSONResponse({"updated": key, "fields": sorted(patch)})
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
        db = connect_arango()
        col = db.collection(CONCEPTS)
        if not col.has(key):
            return JSONResponse({"error": f"concept {key} not found"}, status_code=404)
        col.update({"_key": key, "quizQuestions": qs or None})
        return JSONResponse({"updated": key, "quizQuestions": len(qs) if qs else 0})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
