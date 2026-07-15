"""Learn Hub backend: concept-grounded study over ingested textbooks."""

import os
from pathlib import Path

from fastapi import Body, FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from app.content.store import fetch_outline, fetch_section_content
from app.content.documents import fetch_latest_document
from app.content.elements import fetch_elements, figure_path
from app.api.admin_routes import router as admin_router
from app.pipeline.registry import install as install_job_runners
from app.content.toc_tree import get_toc_tree
from app.platform.db import set_request_db_name
from app.api.audiobook_routes import router as audiobook_router
from app.api.learning_path_routes import router as learning_path_router
from app.api.build_routes import router as build_router
from app.api.concept_study_routes import router as concept_study_router
from app.api.deep_chapter_routes import router as deep_chapter_router
from app.api.extract_routes import router as extract_router
from app.api.ingest_routes import router as ingest_router
from app.study.mastery import compute_activity, compute_calibration, compute_forecast, compute_mastery, record_engagement
from app.api.reading_routes import router as reading_router
from app.api.search_routes import router as search_router
from app.api.study_routes import router as study_router
from app.api.system_routes import router as system_router

app = FastAPI(title="Learn Hub", version="0.2.0")

# Connect the platform jobs ledger to its domain runners (composition root).
install_job_runners()
app.include_router(study_router)
app.include_router(ingest_router)
app.include_router(extract_router)
app.include_router(concept_study_router)
app.include_router(audiobook_router)
app.include_router(learning_path_router)
app.include_router(deep_chapter_router)
app.include_router(build_router)
app.include_router(reading_router)
app.include_router(search_router)
app.include_router(admin_router)
app.include_router(system_router)


@app.middleware("http")
async def user_db_middleware(request: Request, call_next):
    # Multi-tenancy: the Next.js proxy forwards the session user's Postgres
    # schema in X-User-Db. Invalid/absent values fall back to the env default.
    set_request_db_name(request.headers.get("x-user-db"))
    return await call_next(request)


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/api/toc-tree")
def api_toc_tree(doc: str | None = None) -> JSONResponse:
    forest, section_count, err = get_toc_tree(doc)
    if err:
        return JSONResponse({"error": err, "tree": [], "sectionCount": 0}, status_code=503)
    return JSONResponse({"tree": forest, "sectionCount": section_count})


@app.get("/api/mastery")
def api_mastery(doc: str | None = None) -> JSONResponse:
    data = compute_mastery(doc=doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/activity")
def api_activity(doc: str | None = None) -> JSONResponse:
    data = compute_activity(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/forecast")
def api_forecast(doc: str | None = None, days: int = 7) -> JSONResponse:
    """Forgetting forecast: concepts due now + falling due over the next ``days``."""
    return JSONResponse(compute_forecast(doc, days=days))


@app.get("/api/calibration")
def api_calibration(doc: str | None = None) -> JSONResponse:
    """Confidence calibration: accuracy per pre-reveal confidence level."""
    return JSONResponse(compute_calibration(doc))


@app.post("/api/engagement")
def api_engagement(body: dict = Body(default=None)) -> JSONResponse:
    """Record a passive engagement event (read/listen/…) so the dashboard reflects it."""
    body = body or {}
    kind = str(body.get("kind") or "").strip()
    scope = body.get("scope")
    if kind and scope:
        record_engagement(kind, scope, doc=body.get("doc"), concept_key=body.get("conceptKey"))
    return JSONResponse({"ok": True})


@app.get("/api/document")
def api_document(id: str | None = None) -> JSONResponse:
    data = fetch_latest_document(id)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/outline")
def api_outline(doc: str | None = None) -> JSONResponse:
    """The document's outline only (no markdown) — chapter list for the reader."""
    data = fetch_outline(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/document/pdf")
def api_document_pdf(doc: str | None = None):
    """The ORIGINAL uploaded PDF, untouched — the source of truth a reader can verify
    the extracted content against. 404 for documents ingested from non-PDF sources."""
    doc_id = doc
    if not doc_id:
        d = (fetch_latest_document() or {}).get("document")
        doc_id = d.get("id") if d else None
    # Ingest ids are uuid-ish; reject anything that could traverse the shared dir.
    if not doc_id or set(doc_id) - set("0123456789abcdef-"):
        return JSONResponse({"error": "doc required"}, status_code=400)
    path = Path(os.environ.get("SHARED_DIR", "/shared")) / "ingest" / doc_id / "original.pdf"
    if not path.exists():
        return JSONResponse({"error": "no original PDF for this document"}, status_code=404)
    return FileResponse(str(path), media_type="application/pdf")


@app.get("/api/section/{key:path}/content")
def api_section_content(key: str, doc: str | None = None) -> JSONResponse:
    data = fetch_section_content(key, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/elements")
def api_elements(doc: str | None = None, scope: str | None = None, type: str | None = None) -> JSONResponse:
    """The typed retrieval layer: list a document's figures/tables/equations/code, filtered by
    ``scope`` (a toc: key → section + descendants) and/or ``type``. Figures carry an ``imageRef``;
    fetch the bytes from ``/api/figure?doc=&n=<order>``."""
    data = fetch_elements(doc, scope=scope, el_type=type)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/figure")
def api_figure(doc: str, n: int):
    """Serve a figure PNG by (doc, element order ``n``). 404 when the file is missing."""
    p = figure_path(doc, n)
    if p is None:
        return JSONResponse({"error": "figure not found"}, status_code=404)
    return FileResponse(str(p), media_type="image/png")


@app.get("/", response_class=HTMLResponse)
def landing() -> str:
    shared = os.environ.get("SHARED_DIR", "/shared")
    pg_dsn = os.environ.get("POSTGRES_DSN", "")
    # Show host/dbname only — never echo the password into an HTML page.
    pg_summary = " ".join(
        p for p in pg_dsn.split() if p.split("=", 1)[0] in ("host", "port", "dbname")
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Learn Hub backend</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }}
    code {{ background: #eee; padding: 0.15rem 0.4rem; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>Learn Hub backend</h1>
  <p>This is the API service; the app lives in the Next.js frontend. See <code>/health</code>.</p>
  <p>Shared volume: <code>{shared}</code></p>
  <p>Postgres: <code>{pg_summary}</code></p>
</body>
</html>"""
