"""System status for the Process tab's machine strip — keyless and read-only.

One GET answers "what is my machine doing right now": which model Ollama has
resident (native /api/ps: name, VRAM footprint, keep-warm deadline), unified-memory
pressure from /proc/meminfo (honest on DGX Spark — CPU and GPU share it), and the
processing queue's live state. POST /api/queue flips the pause flag the worker honors.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.build_queue import queue_summary, set_queue_paused
from app.llm import _ollama_native_base

router = APIRouter()


def _ollama_ps() -> dict:
    try:
        r = httpx.get(f"{_ollama_native_base()}/api/ps", timeout=3.0)
        models = [
            {
                "name": m.get("name"),
                "size": m.get("size"),
                "sizeVram": m.get("size_vram"),
                "expiresAt": m.get("expires_at"),
            }
            for m in (r.json().get("models") or [])
        ]
        return {"ok": True, "models": models}
    except Exception as exc:  # noqa: BLE001 — strip shows "unreachable", app unaffected
        return {"ok": False, "error": str(exc), "models": []}


def _memory() -> dict | None:
    try:
        info: dict[str, int] = {}
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, value = line.partition(":")
                parts = value.split()
                if parts:
                    info[key.strip()] = int(parts[0])  # kB
        total = info.get("MemTotal", 0) * 1024
        avail = info.get("MemAvailable", 0) * 1024
        if not total:
            return None
        return {"totalBytes": total, "usedBytes": max(0, total - avail)}
    except Exception:  # noqa: BLE001
        return None


@router.get("/api/system")
def api_system() -> JSONResponse:
    return JSONResponse({
        "ollama": _ollama_ps(),
        "memory": _memory(),
        "queue": queue_summary(),
    })


@router.post("/api/queue")
def api_queue_set(body: dict = Body(...)) -> JSONResponse:
    return JSONResponse(set_queue_paused(bool(body.get("paused"))))
