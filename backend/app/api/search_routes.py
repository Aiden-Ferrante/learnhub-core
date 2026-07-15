"""Semantic search + grounded-answer endpoints (the keyless RAG replacement)."""

from __future__ import annotations

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.search import ask, ensure_index, index_status, semantic_search

router = APIRouter()


@router.get("/api/search/index")
def api_index_status(doc: str | None = Query(None)) -> JSONResponse:
    """How many of a doc's content blocks are embedded for semantic search."""
    try:
        return JSONResponse(index_status(doc))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.post("/api/search/index")
def api_build_index(doc: str | None = Query(None), body: dict = Body(default=None)) -> JSONResponse:
    """Embed a doc's (or all) not-yet-embedded content blocks. Idempotent; safe to re-run."""
    limit = int((body or {}).get("limit") or 100000)
    try:
        return JSONResponse(ensure_index(doc, limit=limit))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.get("/api/semantic-search")
def api_semantic_search(
    doc: str | None = Query(None),
    q: str = Query(..., min_length=2),
    k: int = Query(8, ge=1, le=40),
) -> JSONResponse:
    """Natural-language search over the content layer (cosine over MiniLM embeddings)."""
    try:
        return JSONResponse(semantic_search(q, doc, k))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.post("/api/ask")
def api_ask(doc: str | None = Query(None), body: dict = Body(...)) -> JSONResponse:
    """Ask a question; get a grounded, cited answer from the retrieved passages."""
    b = body or {}
    q = str(b.get("q") or b.get("query") or "").strip()
    if not q:
        return JSONResponse({"error": "q (question) required"}, status_code=400)
    k = int(b.get("k") or 6)
    model = b.get("model")
    try:
        return JSONResponse(ask(q, doc, k=k, model=model))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
