"""Emit seedlings from the Learn hub into the host Obsidian vault.

The Learn service runs in Docker and can't see the host filesystem, so it goes
through the vaultwriter HTTP seam (~/Desktop/vaultwriter/server.py) which owns
the vault and the one canonical write contract. This is the wiring point for
synergy #1 (distilled Learn content -> review seedlings): a caller hands a
distilled insight here and it lands in _Review/Seedlings/ for the owner.

Configured by VAULTWRITER_URL (e.g. http://host.docker.internal:8799 or the
host's tailnet name). If unset or unreachable this no-ops cleanly and returns
None, so the study pipeline never breaks on a missing/idle vault seam.
"""
import logging
import os

import httpx

log = logging.getLogger("learn.seedling")

VAULTWRITER_URL = os.environ.get("VAULTWRITER_URL", "").rstrip("/")


def configured() -> bool:
    return bool(VAULTWRITER_URL)


async def emit_seedling(opener, expansion="", source="", links=None,
                        origin="learn-hub", timeout=10.0):
    """POST one seedling to the vault seam. Returns the written path or None."""
    if not VAULTWRITER_URL:
        return None
    opener = (opener or "").strip()
    if not opener:
        return None
    payload = {
        "opener": opener,
        "expansion": expansion or "",
        "source": source or "",
        "links": list(links or []),
        "origin": origin,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{VAULTWRITER_URL}/seedling", json=payload)
            resp.raise_for_status()
            return resp.json().get("path")
    except Exception as exc:  # network / 4xx / 5xx — never break the caller
        log.warning("seedling emit failed (%s): %s", VAULTWRITER_URL, exc)
        return None
