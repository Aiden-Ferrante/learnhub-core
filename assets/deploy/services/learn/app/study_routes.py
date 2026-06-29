"""API routes: deck, quiz, Socratic chat."""

from __future__ import annotations

import time
import uuid
from threading import Lock
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.arango_tree import connect_arango, fetch_section_mentions_by_section
from app.arango_learn import (
    fetch_exam_triples_or_error,
    fetch_triples_or_error,
    format_triples_block,
    triple_id,
    triple_line,
)
from app.llm import ollama_chat_completion
from app.mastery import EVENTS_COLLECTION, record_quiz_event
from app.quiz_gen import build_exam, public_question
from app.rate_limit import check_rate_limit

router = APIRouter()

_quiz_lock = Lock()
_quiz_sessions: dict[str, dict[str, Any]] = {}
SESSION_TTL_SECONDS = 3600


def _sweep_sessions(sessions: dict[str, dict[str, Any]], now: float) -> None:
    """Drop sessions older than the TTL. Caller must hold the lock."""
    expired = [
        sid
        for sid, s in sessions.items()
        if now - float(s.get("created") or 0) > SESSION_TTL_SECONDS
    ]
    for sid in expired:
        del sessions[sid]

SOCRATIC_SYSTEM = """You are a Socratic tutor helping the learner think through material represented only by the following knowledge-graph triples (subject | predicate | object).

Rules:
- Use ONLY information supported by these triples. If the answer is not implied, say you cannot tell from the graph and ask what assumption they are making.
- Prefer short, probing questions over long explanations.
- Triples may be incomplete or wrong (automatic extraction); treat them as tentative.
- Do not invent citations or sources outside this list.
"""


class ExamStartBody(BaseModel):
    scope: str | None = None
    doc: str | None = None
    count: int = Field(default=8, ge=1, le=30)
    include_structural: bool = False
    use_llm: bool = Field(default=True, validation_alias=AliasChoices("useLlm", "use_llm"))
    model: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class ExamGradeBody(BaseModel):
    exam_id: str = Field(validation_alias=AliasChoices("examId", "exam_id"))
    answers: list[int]

    model_config = ConfigDict(populate_by_name=True)


class QuizSessionBody(BaseModel):
    scope: str | None = None
    doc: str | None = None
    include_structural: bool = False
    use_llm: bool = Field(default=False, validation_alias=AliasChoices("useLlm", "use_llm"))
    model: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class QuizAnswerBody(BaseModel):
    session_id: str = Field(validation_alias=AliasChoices("sessionId", "session_id"))
    choice_index: int = Field(validation_alias=AliasChoices("choiceIndex", "choice_index"))

    model_config = ConfigDict(populate_by_name=True)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    messages: list[ChatMessage]
    scope: str | None = None
    doc: str | None = None
    include_structural: bool = False
    model: str | None = None


@router.get("/api/deck")
def api_deck(
    scope: str | None = Query(None),
    count: int = Query(20, ge=1, le=100),
    include_structural: bool = Query(False),
    doc: str | None = Query(None),
) -> dict[str, Any]:
    triples, err = fetch_triples_or_error(
        scope, limit=max(count * 3, 60), include_structural=include_structural, doc=doc
    )
    if err:
        return {"error": err, "cards": [], "tripleCount": 0}
    cards: list[dict[str, Any]] = []
    for t in triples[:count]:
        cards.append(
            {
                "id": triple_id(t),
                "front": f"Subject: {t['subject']}\n\nWhat predicate relates this to «{t['object']}»?",
                "back": f"Predicate: {t['predicate']}\n\nFull triple:\n{triple_line(t)}",
                "triple": t,
            }
        )
    return {"cards": cards, "tripleCount": len(triples), "scope": scope}


@router.get("/api/section-stats")
def api_section_stats(
    scope: str = Query(..., min_length=1),
    include_structural: bool = Query(False),
    doc: str | None = Query(None),
) -> dict[str, Any]:
    triples, err = fetch_triples_or_error(
        scope, limit=400, include_structural=include_structural, doc=doc
    )
    if err:
        return {"error": err, "scope": scope, "tripleCount": 0, "entityCount": 0}
    entities: set[str] = set()
    for t in triples:
        entities.add(t["subject"])
        entities.add(t["object"])
    mention_count = 0
    try:
        db = connect_arango()
        mentions = fetch_section_mentions_by_section(db, doc)
        mention_count = len(mentions.get(scope.strip(), []))
    except Exception:
        mention_count = 0
    return {
        "scope": scope,
        "tripleCount": len(triples),
        "entityCount": len(entities),
        "mentionCount": mention_count,
    }


@router.get("/api/mistakes")
def api_mistakes(
    doc: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Most recent incorrectly answered quiz questions, newest first."""
    try:
        db = connect_arango()
        if not db.has_collection(EVENTS_COLLECTION):
            return {"mistakes": []}
        aql = """
        FOR e IN study_events
          FILTER e.correct == false
          FILTER @doc == null OR e.doc == @doc OR e.doc == null
          SORT e.ts DESC
          LIMIT @limit
          RETURN { sectionKey: e.section_key, ts: e.ts, stem: e.stem, expected: e.expected }
        """
        rows = list(db.aql.execute(aql, bind_vars={"doc": doc, "limit": limit}))
        return {"mistakes": rows}
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {"mistakes": [], "error": str(exc)}


@router.post("/api/quiz/exam")
def api_quiz_exam(body: ExamStartBody) -> dict[str, Any]:
    triples, err = fetch_exam_triples_or_error(
        body.scope, limit=400, include_structural=body.include_structural, doc=body.doc
    )
    if err:
        raise HTTPException(status_code=503, detail=err)

    questions = build_exam(triples, count=body.count, use_llm=body.use_llm, model=body.model)
    if not questions:
        raise HTTPException(
            status_code=400,
            detail="Not enough content in this section to build an exam. "
            "Try another section, raise the question count, or enable structural triples.",
        )

    exam_id = str(uuid.uuid4())
    now = time.time()
    with _quiz_lock:
        _sweep_sessions(_quiz_sessions, now)
        _quiz_sessions[exam_id] = {"questions": questions, "created": now}

    return {
        "examId": exam_id,
        "scope": body.scope,
        "count": len(questions),
        "questions": [public_question(q) for q in questions],
    }


@router.post("/api/quiz/grade")
def api_quiz_grade(body: ExamGradeBody) -> dict[str, Any]:
    with _quiz_lock:
        exam = _quiz_sessions.pop(body.exam_id, None)
    if not exam:
        raise HTTPException(status_code=404, detail="Unknown or expired exam")

    questions: list[dict[str, Any]] = exam["questions"]
    review: list[dict[str, Any]] = []
    score = 0
    for i, q in enumerate(questions):
        given = body.answers[i] if i < len(body.answers) else -1
        ok = given == q["answer_index"]
        if ok:
            score += 1
        your_answer = q["choices"][given] if 0 <= given < len(q["choices"]) else None
        review.append(
            {
                "id": q["id"],
                "stem": q["stem"],
                "correct": ok,
                "yourAnswer": your_answer,
                "expected": q["expected"],
                "explanation": q["explanation"],
                "triple": q["triple"],
            }
        )

    total = len(questions)
    percentage = round(100 * score / total) if total else 0
    return {"score": score, "total": total, "percentage": percentage, "review": review}


@router.post("/api/quiz/session")
def api_quiz_session(body: QuizSessionBody) -> dict[str, Any]:
    """One-question quiz: build a single MCQ and stash it for grading.

    Deterministic by default so every question maps to a stored triple — that
    triple is the unit recorded for mastery coverage on answer.
    """
    triples, err = fetch_exam_triples_or_error(
        body.scope, limit=400, include_structural=body.include_structural, doc=body.doc
    )
    if err:
        raise HTTPException(status_code=503, detail=err)

    questions = build_exam(triples, count=1, use_llm=body.use_llm, model=body.model)
    if not questions:
        raise HTTPException(
            status_code=400,
            detail="Not enough content in this section to build a question. "
            "Try another section or enable structural triples.",
        )

    question = questions[0]
    session_id = str(uuid.uuid4())
    now = time.time()
    with _quiz_lock:
        _sweep_sessions(_quiz_sessions, now)
        _quiz_sessions[session_id] = {
            "question": question,
            "scope": body.scope,
            "doc": body.doc,
            "created": now,
        }

    triple = question.get("triple") or {}
    return {
        "sessionId": session_id,
        "question": question["stem"],
        "choices": question["choices"],
        "subject": triple.get("subject", ""),
        "predicate": triple.get("predicate", ""),
    }


@router.post("/api/quiz/answer")
def api_quiz_answer(body: QuizAnswerBody) -> dict[str, Any]:
    with _quiz_lock:
        session = _quiz_sessions.pop(body.session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Unknown or expired quiz session")

    question = session["question"]
    scope = session.get("scope")
    correct = body.choice_index == question["answer_index"]
    triple = question.get("triple")
    record_quiz_event(
        scope,
        triple_id(triple) if triple else None,
        correct,
        doc=session.get("doc"),
        stem=question.get("stem"),
        expected=question.get("expected"),
    )

    return {
        "correct": correct,
        "expected": question["expected"],
        "explanation": question["explanation"],
        "triple": triple,
    }


@router.post("/api/chat")
def api_chat(request: Request, body: ChatBody) -> dict[str, Any]:
    client = request.client.host if request.client else "unknown"
    if not check_rate_limit(client):
        raise HTTPException(status_code=429, detail="Too many requests; try again in a minute.")

    if not body.messages:
        raise HTTPException(status_code=400, detail="messages is required")
    last_user = None
    for m in reversed(body.messages):
        if m.role == "user":
            last_user = m.content
            break
    if not last_user:
        raise HTTPException(status_code=400, detail="At least one user message is required")

    triples, err = fetch_triples_or_error(
        body.scope, limit=120, include_structural=body.include_structural, doc=body.doc
    )
    if err:
        raise HTTPException(status_code=503, detail=err)
    block = format_triples_block(triples, max_lines=120)
    system = SOCRATIC_SYSTEM + "\n\nTriples:\n" + block

    ollama_messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for m in body.messages:
        if m.role in ("user", "assistant") and m.content.strip():
            ollama_messages.append({"role": m.role, "content": m.content.strip()})

    reply, oerr = ollama_chat_completion(ollama_messages, model=body.model)
    if oerr or reply is None:
        raise HTTPException(status_code=503, detail=oerr or "Empty reply")

    return {
        "reply": reply,
        "contextTripleCount": len(triples),
        "scope": body.scope,
    }
