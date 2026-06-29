"""learn-hub MCP server — lets an MCP client (Claude Code / Claude Desktop) drive the txt2kg
Learn Hub: inspect courses & study state, run processing, study interactively, and curate content.

Design: this server talks ONLY to the Learn service's REST API (default http://localhost:8010).
It holds NO database credentials — every gap (listing courses, editing concepts) is a REST
endpoint the learn service serves with its own Arango access. Keyless & local, matching the rest
of the stack.

Env:
  LEARN_URL      base URL of the learn service   (default http://localhost:8010)
  LEARN_USER_DB  the ArangoDB user db to scope to (default txt2kg) — sent as the X-User-Db header
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

LEARN_URL = (os.environ.get("LEARN_URL") or "http://localhost:8010").rstrip("/")
USER_DB = os.environ.get("LEARN_USER_DB") or "txt2kg"
_HEADERS = {"X-User-Db": USER_DB}

mcp = FastMCP(
    "learn-hub",
    instructions=(
        "Drive the txt2kg Learn Hub — courses built from textbook PDFs into concept-based study "
        "decks with spaced repetition. Typical flow: list_courses() to get a `doc` id, then "
        "get_outline / list_concepts / concept_mastery / due_reviews to inspect. Run processing "
        "with extract() and prepare_quizzes(). Study interactively with quiz_next() → quiz_answer(), "
        "and grade recalls with grade_review(grade 1-4). Curate with update_concept() and "
        "set_concept_questions(). Every study/concept call needs the course `doc` (a learnDocId); "
        "`scope` is a TOC section key like 'toc:language-models' (omit = whole course)."
    ),
)


def _req(method: str, path: str, *, params: dict | None = None, json: dict | None = None) -> Any:
    """One HTTP call to the learn API → parsed JSON (or an {'error': ...} dict). Long timeout
    because extraction/prepare kick off background jobs but conversion/quiz can still be slow."""
    url = f"{LEARN_URL}{path}"
    try:
        with httpx.Client(timeout=120.0) as c:
            r = c.request(method, url, params=params, json=json, headers=_HEADERS)
        body: Any
        try:
            body = r.json()
        except Exception:  # noqa: BLE001 — non-JSON (shouldn't happen on these routes)
            body = {"raw": r.text[:2000]}
        if r.status_code >= 400 and isinstance(body, dict):
            body.setdefault("error", f"HTTP {r.status_code}")
        return body
    except httpx.HTTPError as exc:
        return {"error": f"cannot reach learn service at {url}: {exc}"}


# ── Inspect (read-only) ─────────────────────────────────────────────────────────────────────
@mcp.tool()
def list_courses() -> Any:
    """List the processed courses. Each item's `docId` is the `doc` other tools need."""
    return _req("GET", "/api/documents")


@mcp.tool()
def get_outline(doc: str) -> Any:
    """The course's table of contents (chapters → sections, with `sectionKey`s usable as `scope`)."""
    return _req("GET", "/api/outline", params={"doc": doc})


@mcp.tool()
def list_concepts(doc: str, scope: str | None = None) -> Any:
    """Concepts for a course, or just one section/chapter when `scope` (a toc: key) is given.
    Returns name, kind, signal, source, prereqs, and conceptKey (needed for grading/editing)."""
    if scope:
        return _req("GET", f"/api/section/{scope}/concepts", params={"doc": doc})
    return _req("GET", "/api/concepts", params={"doc": doc})


@mcp.tool()
def get_chapter(doc: str, chapter: str, max_chars: int = 0) -> Any:
    """Pull an ENTIRE chapter's text into context. `chapter` may be a number ("3"), an exact
    sectionKey ("toc:3"), or a title substring ("finetuning"). Returns the full chapter markdown
    (every block in the chapter's page span — robust to the slug/number key mismatch), its title &
    page range, the sub-section list, and an approx token count. Set `max_chars` to cap a huge
    chapter. On a miss, the result lists the available chapters."""
    params: dict[str, Any] = {"doc": doc, "ref": chapter}
    if max_chars:
        params["max_chars"] = max_chars
    return _req("GET", "/api/chapter", params=params)


@mcp.tool()
def concept_mastery(doc: str) -> Any:
    """Per-concept mastery + gating (mastered / ready / locked) and overall counts for the course."""
    return _req("GET", "/api/concept-mastery", params={"doc": doc})


@mcp.tool()
def due_reviews(doc: str, limit: int = 20) -> Any:
    """The spaced-repetition queue: which concepts are due now, plus due/new/later counts."""
    return _req("GET", "/api/review/queue", params={"doc": doc, "limit": limit})


@mcp.tool()
def section_content(doc: str, scope: str) -> Any:
    """The reading text (markdown blocks, with page provenance) for a section/chapter `scope`."""
    return _req("GET", f"/api/section/{scope}/content", params={"doc": doc})


@mcp.tool()
def get_section(doc: str, section_key: str) -> Any:
    """Pull ONE section's text into context (a sub-chapter pull). `section_key` is a toc: key from
    get_outline / list_concepts / a search_text match. Returns the section's markdown + page range
    + approx token count — smaller than a whole chapter."""
    res = _req("GET", f"/api/section/{section_key}/content", params={"doc": doc})
    if not isinstance(res, dict) or res.get("error"):
        return res
    md = res.get("markdown") or ""
    blocks = res.get("blocks") or []
    return {
        "sectionKey": res.get("sectionKey") or section_key,
        "heading": (blocks[0].get("heading") if blocks else None),
        "pageStart": res.get("pageStart"),
        "pageEnd": res.get("pageEnd"),
        "charCount": len(md),
        "approxTokens": len(md) // 4,
        "markdown": md,
    }


@mcp.tool()
def search_text(doc: str, query: str, limit: int = 8, full: bool = False) -> Any:
    """Find where a topic is discussed WITHOUT knowing the chapter (e.g. "quantization"). Returns
    the best-matching passages with section, heading, page, score and a snippet. Set `full=True`
    for the matched blocks' full markdown, or take a match's `sectionKey` into get_section()."""
    params: dict[str, Any] = {"doc": doc, "q": query, "limit": limit}
    if full:
        params["full"] = "true"
    return _req("GET", "/api/search", params=params)


# ── Processing (writes to the course) ───────────────────────────────────────────────────────
@mcp.tool()
def extract(doc: str, scope: str | None = None, section_keys: list[str] | None = None,
            model: str | None = None) -> Any:
    """Start a background concept extraction. `scope`=one chapter (+descendants), `section_keys`=an
    exact set, neither=whole document (slow). Returns immediately; poll with extraction_status()."""
    body: dict[str, Any] = {}
    if section_keys:
        body["sectionKeys"] = section_keys
    if model:
        body["model"] = model
    params = {"doc": doc}
    if scope:
        params["scope"] = scope
    return _req("POST", "/api/extract", params=params, json=body)


@mcp.tool()
def extraction_status(doc: str, scope: str | None = None) -> Any:
    """Poll a running extraction: idle | running | done | error, with per-section progress."""
    params = {"doc": doc}
    if scope:
        params["scope"] = scope
    return _req("GET", "/api/extract/status", params=params)


@mcp.tool()
def prepare_quizzes(doc: str, scope: str) -> Any:
    """Author the higher-order quiz questions (apply/distinguish/why) for every concept in a
    chapter `scope`, in the background. Returns {total, authored, running}."""
    return _req("POST", "/api/concept-quiz/prepare", json={"doc": doc, "scope": scope})


@mcp.tool()
def quiz_prepare_status(doc: str, scope: str) -> Any:
    """How many of a chapter `scope`'s concepts have quiz questions authored yet (+ running flag)."""
    return _req("GET", "/api/concept-quiz/prepare", params={"doc": doc, "scope": scope})


# ── Study (writes study events) ─────────────────────────────────────────────────────────────
@mcp.tool()
def quiz_next(doc: str, scope: str | None = None) -> Any:
    """Draw one multiple-choice question for the course (or chapter `scope`). Returns a `sessionId`,
    a `stem`, and `choices`; pass the chosen index to quiz_answer(). The answer is held server-side."""
    return _req("POST", "/api/concept-quiz/session", json={"doc": doc, "scope": scope})


@mcp.tool()
def quiz_answer(session_id: str, choice_index: int) -> Any:
    """Submit an answer to a quiz_next() session (0-based `choice_index`). Returns correctness +
    the right answer + explanation, and records the attempt so mastery moves."""
    return _req("POST", "/api/concept-quiz/answer",
                json={"sessionId": session_id, "choiceIndex": choice_index})


@mcp.tool()
def grade_review(concept_key: str, grade: int, doc: str | None = None) -> Any:
    """Grade a recall on a concept (1=Again, 2=Hard, 3=Good, 4=Easy): advances its spaced-repetition
    schedule and logs a study event. `concept_key` comes from list_concepts()/due_reviews()."""
    return _req("POST", "/api/review/grade",
                json={"conceptKey": concept_key, "grade": grade, "doc": doc})


# ── Author / curate (most powerful) ─────────────────────────────────────────────────────────
@mcp.tool()
def update_concept(concept_key: str, fields: dict) -> Any:
    """Edit a concept's curatable fields. Allowed: name, signal, source, kind
    (definition|theorem|principle|result|method), prereqNames (list[str]), questions
    (list of {q,a} study cards). Keys/provenance are immutable; review history is preserved."""
    return _req("PATCH", f"/api/concept/{concept_key}", json=fields)


@mcp.tool()
def set_concept_questions(concept_key: str, questions: list[dict] | None = None) -> Any:
    """Replace a concept's cached quiz MCQs. Pass a list of
    {stem, options:[4], answerIndex, explanation, kind} to set them, or omit/null to CLEAR so the
    concept re-authors fresh on next study (use after changing the author prompt/model)."""
    return _req("PUT", f"/api/concept/{concept_key}/questions", json={"questions": questions})


# ── Reading & audio ─────────────────────────────────────────────────────────────────────────
@mcp.tool()
def orient(doc: str, scope: str) -> Any:
    """A short orientation for a chapter `scope` — what it's about and why it matters, to read
    before diving in. Cached; generated on first request."""
    return _req("GET", "/api/orient", params={"doc": doc, "scope": scope})


@mcp.tool()
def skeleton(doc: str, scope: str) -> Any:
    """The chapter's outline 'skeleton' — its sections with a one-line essence each, indented to
    the TOC hierarchy. Good for top-down review."""
    return _req("GET", "/api/skeleton", params={"doc": doc, "scope": scope})


@mcp.tool()
def reading_guide(doc: str, scope: str) -> Any:
    """The per-section reading guidance for a chapter `scope` (what to look for / key ideas).
    Author it first with prepare_reading_guide() if empty."""
    return _req("GET", "/api/reading-guide", params={"doc": doc, "scope": scope})


@mcp.tool()
def prepare_reading_guide(doc: str, scope: str) -> Any:
    """Author all of a chapter `scope`'s reading guidance up front (background). Returns status."""
    return _req("POST", "/api/reading-guide/prepare", json={"doc": doc, "scope": scope})


@mcp.tool()
def flashcard_deck(doc: str, scope: str | None = None, count: int = 20) -> Any:
    """A graph-grounded flashcard deck (front/back from the KG triples) for a course or chapter
    `scope`. Read-only — for reviewing, distinct from the spaced-repetition `due_reviews` queue."""
    params: dict[str, Any] = {"doc": doc, "count": count}
    if scope:
        params["scope"] = scope
    return _req("GET", "/api/deck", params=params)


@mcp.tool()
def audiobook_voices() -> Any:
    """List the available text-to-speech voices for audiobook generation."""
    return _req("GET", "/api/audiobook/voices")


@mcp.tool()
def generate_audiobook(doc: str, scope: str, source: str = "text", voice: str = "tara") -> Any:
    """Start generating a chapter `scope`'s audiobook (background). `source`: text | concepts |
    guided; `voice` from audiobook_voices(). Poll with audiobook_status()."""
    return _req("POST", "/api/audiobook", params={"doc": doc, "scope": scope},
                json={"source": source, "voice": voice})


@mcp.tool()
def audiobook_status(doc: str, scope: str, source: str = "text") -> Any:
    """Progress of a chapter's audiobook generation (and whether a finished file exists)."""
    return _req("GET", "/api/audiobook/status", params={"doc": doc, "scope": scope, "source": source})


@mcp.tool()
def audiobook_list(doc: str) -> Any:
    """List the audiobooks already generated for a course."""
    return _req("GET", "/api/audiobook/list", params={"doc": doc})


if __name__ == "__main__":
    # stdio (default) for local clients like Claude Code; set LEARN_MCP_TRANSPORT=http to serve a
    # tailnet-reachable Streamable-HTTP endpoint for Claude Desktop on another device.
    transport = (os.environ.get("LEARN_MCP_TRANSPORT") or "stdio").lower()
    if transport in ("http", "streamable-http"):
        from mcp.server.transport_security import TransportSecuritySettings

        mcp.settings.host = os.environ.get("LEARN_MCP_HOST") or "0.0.0.0"
        mcp.settings.port = int(os.environ.get("LEARN_MCP_PORT") or "8011")
        # DNS-rebinding protection rejects unknown Host headers (the 421 you'd otherwise get over
        # the tailnet). Allow localhost + the tailnet hostname through; `host:*` = that host on any
        # port. Override the list with LEARN_MCP_ALLOWED_HOSTS (comma-separated host[:port|:*]).
        default_hosts = "localhost:*,127.0.0.1:*,spark-9415.tailff006f.ts.net:*"
        allowed = [h.strip() for h in
                   (os.environ.get("LEARN_MCP_ALLOWED_HOSTS") or default_hosts).split(",") if h.strip()]
        origins = [f"http://{h}" for h in allowed] + [f"https://{h}" for h in allowed]
        mcp.settings.transport_security = TransportSecuritySettings(
            enable_dns_rebinding_protection=True, allowed_hosts=allowed, allowed_origins=origins
        )
        mcp.run(transport="streamable-http")
    else:
        mcp.run()
