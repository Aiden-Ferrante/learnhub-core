"""Keyword search over a course's stored content — the one full-text locate tool.

Deliberately simple (term coverage > frequency scoring over section_content markdown,
in Python): it exists so a reader/agent can locate a topic ("quantization") without
knowing the chapter, then pull it with fetch_section_content / fetch_chapter. No
embeddings, no external services.
"""

from __future__ import annotations

from typing import Any

from app.gateways import db


def _snippet(text: str, terms: list[str], width: int = 260) -> str:
    """A ~`width`-char window of `text` centred on the first matched term."""
    low = text.lower()
    pos = min((low.find(t) for t in terms if low.find(t) >= 0), default=-1)
    if pos < 0:
        return text[:width].strip()
    start = max(0, pos - width // 3)
    out = text[start : start + width].strip()
    return ("…" if start > 0 else "") + out + ("…" if start + width < len(text) else "")


def keyword_search(doc_id: str | None, query: str, limit: int = 8, full: bool = False) -> dict[str, Any]:
    """Best-matching passages for `query` with section, heading, page, score and a snippet.
    Coverage (how many distinct query terms appear) dominates raw frequency, so a passage
    mentioning every term beats one that just repeats a common word like "model"."""
    terms = [t for t in "".join(c if c.isalnum() else " " for c in query.lower()).split() if len(t) > 1]
    if not terms:
        return {"query": query, "matches": []}
    with db() as conn:
        blocks = conn.execute(
            'SELECT section_key AS "sectionKey", heading, markdown, '
            'page_start AS "pageStart", page_end AS "pageEnd" '
            "FROM raw_content WHERE markdown IS NOT NULL "
            "AND (%(d)s::text IS NULL OR doc_id = %(d)s)",
            {"d": doc_id},
        ).fetchall()
    scored = []
    for b in blocks:
        md = b.get("markdown") or ""
        low = md.lower()
        head = (b.get("heading") or "").lower()
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
    return {"query": query, "terms": terms, "total": len(scored), "matches": matches}
