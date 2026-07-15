"""API routes for audiobook generation (Orpheus TTS). Generation is long, so POST
starts a background job and the client polls; the MP3 is streamed/downloaded from /file."""

from __future__ import annotations

import os

from fastapi import APIRouter, Body
from fastapi.responses import FileResponse, JSONResponse

from app.media.audiobook import (
    audiobook_path,
    audiobook_status,
    audiobook_timeline,
    list_audiobooks,
    start_audiobook,
)
from app.content.documents import resolve_doc_id
from app.media.tts_orpheus import VOICES

router = APIRouter()


@router.get("/api/audiobook/voices")
def api_voices() -> JSONResponse:
    return JSONResponse({"voices": list(VOICES)})


@router.post("/api/audiobook")
async def api_audiobook(
    doc: str | None = None,
    scope: str | None = None,
    body: dict | None = Body(default=None),
) -> JSONResponse:
    """Start generating a chapter's audiobook. body: ``{source: text|concepts, voice}``."""
    body = body or {}
    source = str(body.get("source") or "text")
    if source not in ("text", "concepts", "guided"):
        source = "text"
    voice = str(body.get("voice") or "tara")
    data = start_audiobook(doc, scope, source=source, voice=voice)
    return JSONResponse(data, status_code=503 if data.get("status") == "error" else 200)


@router.get("/api/audiobook/status")
def api_status(doc: str | None = None, scope: str | None = None, source: str = "text") -> JSONResponse:
    return JSONResponse(audiobook_status(doc, scope, source))


@router.get("/api/audiobook/list")
def api_list(doc: str | None = None) -> JSONResponse:
    return JSONResponse(list_audiobooks(doc))


@router.get("/api/audiobook/timeline")
def api_timeline(doc: str | None = None, scope: str | None = None, source: str = "text") -> JSONResponse:
    """Chunk→time map for read-along highlighting (exact sidecar, or estimated for older MP3s)."""
    data = audiobook_timeline(doc, scope, source)
    return JSONResponse(data, status_code=404 if data.get("error") else 200)


@router.get("/api/audiobook/file", response_model=None)
def api_file(
    doc: str | None = None,
    scope: str | None = None,
    source: str = "text",
    download: int = 0,
) -> FileResponse | JSONResponse:
    """Stream the generated MP3 (inline for the player; ``?download=1`` to save it)."""
    doc_id = resolve_doc_id(doc)
    if not doc_id:
        return JSONResponse({"error": "no document"}, status_code=404)
    path = audiobook_path(doc_id, scope, source)
    if not os.path.exists(path):
        return JSONResponse({"error": "not generated yet"}, status_code=404)
    safe_scope = (scope or "audiobook").replace(":", "-")
    filename = f"{safe_scope}-{source}.mp3"
    if download:
        return FileResponse(path, media_type="audio/mpeg", filename=filename)
    return FileResponse(path, media_type="audio/mpeg")  # inline → <audio> + range seeking
