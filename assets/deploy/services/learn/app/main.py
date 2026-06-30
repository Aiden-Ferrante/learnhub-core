"""Learning environment: TOC tree + graph-grounded study."""

from pathlib import Path

import os

from fastapi import Body, FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.templating import Jinja2Templates

from app.arango_content import (
    fetch_elements,
    fetch_latest_document,
    fetch_outline,
    fetch_page,
    fetch_section_content,
    figure_path,
)
from app.admin_routes import router as admin_router
from app.arango_tree import get_toc_tree, render_toc_tree_html, set_request_db_name
from app.audiobook_routes import router as audiobook_router
from app.learning_path_routes import router as learning_path_router
from app.concept_study_routes import router as concept_study_router
from app.extract_routes import router as extract_router
from app.ingest_routes import router as ingest_router
from app.mastery import compute_activity, compute_calibration, compute_forecast, compute_mastery, record_engagement
from app.reading_routes import router as reading_router
from app.search_routes import router as search_router
from app.study_routes import router as study_router

BASE_DIR = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app = FastAPI(title="txt2kg Learning", version="0.2.0")
app.include_router(study_router)
app.include_router(ingest_router)
app.include_router(extract_router)
app.include_router(concept_study_router)
app.include_router(audiobook_router)
app.include_router(learning_path_router)
app.include_router(reading_router)
app.include_router(search_router)
app.include_router(admin_router)


@app.middleware("http")
async def user_db_middleware(request: Request, call_next):
    # Multi-tenancy: the Next.js proxy forwards the session user's ArangoDB
    # database in X-User-Db. Invalid/absent values fall back to the env default.
    set_request_db_name(request.headers.get("x-user-db"))
    return await call_next(request)


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/api/toc-tree")
def api_toc_tree(doc: str | None = None) -> JSONResponse:
    forest, edge_count, err, mention_count = get_toc_tree(doc)
    if err:
        return JSONResponse(
            {
                "error": err,
                "tree": [],
                "edgeCount": 0,
                "mentionEdgeCount": 0,
            },
            status_code=503,
        )
    return JSONResponse(
        {
            "tree": forest,
            "edgeCount": edge_count,
            "mentionEdgeCount": mention_count,
        }
    )


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


@app.get("/api/section/{key:path}/content")
def api_section_content(key: str, doc: str | None = None) -> JSONResponse:
    data = fetch_section_content(key, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/page/{page_no}")
def api_page(page_no: int, doc: str | None = None) -> JSONResponse:
    data = fetch_page(page_no, doc)
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


@app.get("/tree")
def tree_page(request: Request):
    forest, edge_count, err, mention_count = get_toc_tree()
    tree_html = render_toc_tree_html(forest) if forest and not err else ""
    return templates.TemplateResponse(
        request,
        "tree.html",
        {
            "tree": forest,
            "tree_html": tree_html,
            "edge_count": edge_count,
            "mention_edge_count": mention_count,
            "error": err,
        },
    )


@app.get("/flashcards")
def flashcards_page(request: Request):
    return templates.TemplateResponse(request, "flashcards.html", {})


@app.get("/quiz")
def quiz_page(request: Request):
    return templates.TemplateResponse(request, "quiz.html", {})


@app.get("/socratic")
def socratic_page(request: Request):
    return templates.TemplateResponse(request, "socratic.html", {})


@app.get("/", response_class=HTMLResponse)
def landing() -> str:
    shared = os.environ.get("SHARED_DIR", "/shared")
    arango_url = os.environ.get("ARANGODB_URL", "")
    arango_db = os.environ.get("ARANGODB_DB", "")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Learning environment</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }}
    code {{ background: #eee; padding: 0.15rem 0.4rem; border-radius: 4px; }}
    a {{ color: #1a6; }}
    ul.links {{ list-style: none; padding: 0; }}
    ul.links li {{ margin: 0.35rem 0; }}
  </style>
</head>
<body>
  <h1>Learning environment</h1>
  <p>Graph-grounded study using the same ArangoDB as txt2kg. Optional query <code>?scope=toc:1.1.1</code> on study pages.</p>
  <ul class="links">
    <li><a href="/tree">TOC hierarchy + entities</a></li>
    <li><a href="/flashcards">Flashcards</a> (triples)</li>
    <li><a href="/quiz">Exam / quiz</a> (section-scoped multiple choice)</li>
    <li><a href="/socratic">Socratic chat</a> (Ollama + subgraph)</li>
  </ul>
  <p>Shared volume: <code>{shared}</code></p>
  <p>ArangoDB: <code>{arango_url}</code> / DB <code>{arango_db}</code></p>
</body>
</html>"""
