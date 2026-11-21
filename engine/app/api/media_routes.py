"""Media routes: audiobook TTS — voices, generation, status, timeline, and the MP3 stream.

Generation is long, so POST /api/audiobook starts a background job and the client
polls /status; the MP3 is streamed/downloaded from /file."""

from __future__ import annotations

import os

from fastapi import APIRouter, Body
from fastapi.responses import FileResponse, JSONResponse

from app.supplemental.media import audiobook_path, audiobook_status, audiobook_timeline, list_audiobooks, start_audiobook
from app.process.content import resolve_doc_id
from app.supplemental.media import DEFAULT_VOICE, VOICES

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
    """Start generating a chapter's audiobook (raw chapter text). body: ``{voice}``."""
    body = body or {}
    # Empty means "the engine's default" — don't name a voice here, or a rename in the
    # engine turns into a silent fallback at the boundary instead of an obvious error.
    voice = str(body.get("voice") or DEFAULT_VOICE)
    data = start_audiobook(doc, scope, voice=voice)
    return JSONResponse(data, status_code=503 if data.get("status") == "error" else 200)


@router.get("/api/audiobook/status")
def api_status(doc: str | None = None, scope: str | None = None) -> JSONResponse:
    return JSONResponse(audiobook_status(doc, scope))


@router.get("/api/audiobook/list")
def api_list(doc: str | None = None) -> JSONResponse:
    return JSONResponse(list_audiobooks(doc))


@router.get("/api/audiobook/timeline")
def api_timeline(doc: str | None = None, scope: str | None = None) -> JSONResponse:
    """Chunk→time map for read-along highlighting (exact sidecar, or estimated for older MP3s)."""
    data = audiobook_timeline(doc, scope)
    return JSONResponse(data, status_code=404 if data.get("error") else 200)


@router.get("/api/audiobook/file", response_model=None)
def api_file(
    doc: str | None = None,
    scope: str | None = None,
    download: int = 0,
) -> FileResponse | JSONResponse:
    """Stream the generated MP3 (inline for the player; ``?download=1`` to save it)."""
    doc_id = resolve_doc_id(doc)
    if not doc_id:
        return JSONResponse({"error": "no document"}, status_code=404)
    try:
        path = audiobook_path(doc_id, scope)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    if not os.path.exists(path):
        return JSONResponse({"error": "not generated yet"}, status_code=404)
    safe_scope = (scope or "audiobook").replace(":", "-")
    filename = f"{safe_scope}.mp3"
    if download:
        return FileResponse(path, media_type="audio/mpeg", filename=filename)
    return FileResponse(path, media_type="audio/mpeg")  # inline → <audio> + range seeking
