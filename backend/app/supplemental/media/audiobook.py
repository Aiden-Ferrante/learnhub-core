"""Audiobook generation: a chapter (or section) → a downloadable MP3 narrated by a
local Kokoro-82M voice, in-process on the GPU.

One source: the chapter's raw markdown, cleaned for narration.

Still a background job (``POST /api/audiobook`` starts it, the client polls ``/status``,
then streams the MP3 from ``/file``) — but no longer a *long* one. A chapter renders in
about six seconds rather than tens of minutes, which is why this module no longer
checkpoints, resumes, or batches; see docs/adr/0002-kokoro-replaces-orpheus-tts.md.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time

import numpy as np

from app.process.content import resolve_doc_id
from app.process.content import load_section_blocks
from app.supplemental.media.tts_kokoro import DEFAULT_VOICE, SAMPLE_RATE, VOICES, synthesize

AUDIO_DIR = os.environ.get("AUDIOBOOK_DIR", "/shared/audiobooks")
_GAP = np.zeros(int(SAMPLE_RATE * 0.35), dtype=np.float32)  # pause between segments


# --------------------------------------------------------------------------- #
# Narration cleaning (pure, unit-testable)
# --------------------------------------------------------------------------- #

_FENCE = re.compile(r"```.*?```", re.DOTALL)
_DISPLAY_MATH = re.compile(r"\$\$.*?\$\$", re.DOTALL)
_INLINE_MATH = re.compile(r"\$[^$\n]*\$")
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_HTML = re.compile(r"<[^>]+>")
_CITATION = re.compile(r"\[\d+(?:\s*[,–-]\s*\d+)*\]")  # [12], [3-5]
_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEP = re.compile(r"^\s*\|?[\s:|-]+\|?\s*$")


def clean_for_narration(markdown: str) -> str:
    """Turn textbook markdown into speakable prose: drop code/math/tables/images, keep
    link text, and convert headings into a spoken section break."""
    text = _FENCE.sub(" ", markdown)
    text = _DISPLAY_MATH.sub(" ", text)
    text = _INLINE_MATH.sub(" ", text)
    text = _IMAGE.sub(" ", text)
    text = _LINK.sub(r"\1", text)
    text = _HTML.sub(" ", text)
    text = _CITATION.sub("", text)

    out_lines: list[str] = []
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            out_lines.append("")
            continue
        if _TABLE_ROW.match(line) or _TABLE_SEP.match(line):
            continue  # tables don't narrate
        m = _HEADING.match(line)
        if m:
            title = m.group(2).strip().lstrip("#").strip()
            title = re.sub(r"[*_`]", "", title)
            if title:
                out_lines.append(f"{title}.")  # heading as a spoken break
            continue
        line = re.sub(r"^\s{0,3}>\s?", "", line)          # blockquote marker
        line = re.sub(r"^\s*[-*+]\s+", "", line)           # bullet marker
        line = re.sub(r"^\s*\d+\.\s+", "", line)           # ordered-list marker
        line = re.sub(r"[*_`]", "", line)                  # bold/italic/code marks
        out_lines.append(line)

    text = "\n".join(out_lines)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)   # close gaps left by stripped math/citations
    text = re.sub(r"([.,;:!?]){2,}", r"\1", text)   # "distribution.. See" → "distribution. See"
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


_SENT = re.compile(r"(?<=[.!?])\s+")


def segment_text(text: str, max_chars: int = 280) -> list[str]:
    """Split into short, TTS-stable chunks (sentence-grouped, bounded length).

    Originally sized because Orpheus drifted on long passages. Kokoro is a fixed-speaker
    model carrying no state between calls, so drift is not the reason any more — but the
    chunking still earns its keep: it is what produces the per-chunk read-along timeline.
    """
    chunks: list[str] = []
    for para in re.split(r"\n{2,}", text):
        para = para.replace("\n", " ").strip()
        if not para:
            continue
        cur = ""
        for sent in _SENT.split(para):
            sent = sent.strip()
            if not sent:
                continue
            if len(sent) > max_chars:
                # hard-wrap an over-long sentence on commas/clauses
                for piece in re.split(r"(?<=[,;:])\s+", sent):
                    piece = piece.strip()
                    if not piece:
                        continue
                    if len(cur) + len(piece) + 1 > max_chars and cur:
                        chunks.append(cur.strip())
                        cur = ""
                    cur = f"{cur} {piece}".strip()
                continue
            if len(cur) + len(sent) + 1 > max_chars and cur:
                chunks.append(cur.strip())
                cur = ""
            cur = f"{cur} {sent}".strip()
        if cur.strip():
            chunks.append(cur.strip())
    return [c for c in chunks if any(ch.isalpha() for ch in c)]


# --------------------------------------------------------------------------- #
# Narration script (raw chapter text)
# --------------------------------------------------------------------------- #

def chapter_segments(doc_id: str, scope: str | None) -> list[str]:
    """Chapter's source markdown (per section, heading first), cleaned + segmented."""
    sections = load_section_blocks(doc_id, scope=scope)
    segs: list[str] = []
    for s in sections:
        heading = (s.heading or "").strip()
        if heading and not heading.lower().startswith("toc:"):
            segs.append(f"{re.sub(r'[*_`#]', '', heading).strip()}.")
        segs.extend(segment_text(clean_for_narration(s.markdown)))
    return segs


# --------------------------------------------------------------------------- #
# Synthesis + MP3
# --------------------------------------------------------------------------- #

def _slug(scope: str | None) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", scope or "whole").strip("-") or "whole"


def _doc_dir(doc_id: str) -> str:
    """This document's audio directory, with the id proved safe to join.

    ``scope`` is slugified, but ``doc_id`` reaches here straight from the query string —
    ``resolve_doc_id`` hands back whatever it was given when non-empty — and
    ``os.path.join`` DISCARDS everything before an absolute segment. So ``?doc=/etc`` built
    a path outside AUDIO_DIR entirely. Same guard ``figure_path`` already applies: strip to
    the id charset and refuse if nothing recognisable is left.
    """
    safe = re.sub(r"[^A-Za-z0-9_-]", "", doc_id or "")
    if not safe:
        raise ValueError(f"unsafe document id: {doc_id!r}")
    return os.path.join(AUDIO_DIR, safe)


# File names keep the historical "__text" suffix so already-generated narrations
# stay playable after the source dimension was removed.

def audiobook_path(doc_id: str, scope: str | None) -> str:
    return os.path.join(_doc_dir(doc_id), f"{_slug(scope)}__text.mp3")


def timeline_path(doc_id: str, scope: str | None) -> str:
    """Sidecar mapping narration chunks to playback times — the read-along data."""
    return os.path.join(_doc_dir(doc_id), f"{_slug(scope)}__text.timeline.json")


def estimate_weights(segments: list[str], gap_sec: float = _GAP.size / SAMPLE_RATE, chars_per_sec: float = 14.0) -> list[float]:
    """Relative duration weights for chunks whose real audio timing is unknown (MP3s
    generated before timelines existed). Speech time ≈ chars/rate, plus the fixed
    inter-chunk gap — the client scales these to the actual MP3 duration."""
    return [max(1.0, len(s)) / chars_per_sec + gap_sec for s in segments]


# Neither a gate nor a worker pool any more. Both existed to wring throughput out of
# Orpheus, whose per-stream cost was high enough that batching paid; Kokoro is flat under
# concurrency (measured 50.4x / 51.9x / 49.0x at 1 / 4 / 8 streams) because one stream
# already saturates the GPU, and the queue serializes narrations anyway.


def _encode_mp3(wav: np.ndarray, out_path: str) -> None:
    import soundfile as sf

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_wav = tmp.name
    try:
        sf.write(tmp_wav, wav, SAMPLE_RATE)
        subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_wav, "-codec:a", "libmp3lame", "-q:a", "4", out_path],
            check=True, capture_output=True,
        )
    finally:
        os.unlink(tmp_wav)


def make_audiobook(doc_id: str | None, scope: str | None,
                   voice: str = DEFAULT_VOICE, on_progress=None) -> dict:
    """Render a chapter to an MP3. Blocking + GPU-bound — call from a worker thread.

    Straight through, no checkpoints. This used to write every chunk to a work dir and
    resume from it, because a crash mid-render lost hours of Orpheus GPU time. Kokoro
    renders a chapter in about six seconds, so resuming is more machinery than re-rendering
    is cost — and the checkpoint layer had its own bug (a chunk that synthesized to silence
    was saved as a valid checkpoint and never retried, so a sentence went missing for good).
    Deleting it fixed that by construction.

    Synthesis is single-stream on purpose: concurrency is flat for this engine, see
    tts_kokoro.
    """
    t0 = time.time()
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    if voice not in VOICES:
        voice = DEFAULT_VOICE

    segments = chapter_segments(doc_id, scope)
    # Drop consecutive duplicates (e.g. a heading that the section body repeats).
    deduped: list[str] = []
    for seg in segments:
        if deduped and seg.strip().lower() == deduped[-1].strip().lower():
            continue
        deduped.append(seg)
    segments = deduped
    if not segments:
        return {"docId": doc_id, "scope": scope, "error": "no narratable text in this scope"}

    total = len(segments)
    if on_progress:
        on_progress(0, total, None)

    # Exact per-chunk playback times (the read-along timeline) fall out of the concat for
    # free — captured here, while the sample counts are in hand.
    pieces: list[np.ndarray] = []
    chunk_times: list[dict] = []
    silent: list[int] = []
    cursor = 0
    for i, seg in enumerate(segments):
        wav = synthesize(seg, voice=voice)
        if on_progress:
            on_progress(i + 1, total, seg[:60])
        if not wav.size:
            # Nothing speakable in this segment. Recorded rather than silently skipped —
            # that silence is precisely what the old checkpoint layer hid.
            silent.append(i)
            continue
        start = cursor / SAMPLE_RATE
        cursor += wav.size
        chunk_times.append({"text": seg, "start": round(start, 3),
                            "end": round(cursor / SAMPLE_RATE, 3)})
        cursor += _GAP.size
        pieces.append(wav)
        pieces.append(_GAP)

    if not pieces:
        return {"docId": doc_id, "scope": scope, "error": "synthesis produced no audio"}

    full = np.concatenate(pieces)
    out_path = audiobook_path(doc_id, scope)
    _encode_mp3(full, out_path)
    tl_path = timeline_path(doc_id, scope)
    tmp_tl = f"{tl_path}.tmp"
    with open(tmp_tl, "w") as f:
        json.dump({"exact": True, "chunks": chunk_times}, f)
    os.replace(tmp_tl, tl_path)

    return {
        **({"silentSegments": len(silent)} if silent else {}),
        "docId": doc_id,
        "scope": scope,
        "voice": voice,
        "segments": total,
        "durationSec": round(full.size / SAMPLE_RATE, 1),
        "file": out_path,
        "seconds": round(time.time() - t0, 1),
    }


# --------------------------------------------------------------------------- #
# Background job (on the persistent queue — the "audiobook" kind)
# --------------------------------------------------------------------------- #

def _audio_scope(scope: str | None) -> str:
    """Queue key scope for an audiobook. The "::text" suffix is historical (it carried a
    source dimension once) and is kept so job keys stay stable across the removal."""
    return f"{scope or ''}::text"


def _find_audiobook_job(doc_id: str, scope: str | None) -> dict | None:
    from app.gateways import list_builds

    for b in list_builds(doc_id, kind="audiobook").get("builds", []):
        if (b.get("source") or "text") == "text" and (b.get("realScope") or None) == (scope or None):
            return b
    return None


def run_audiobook(job: dict, ctx) -> dict:
    """``audiobook`` queue runner. make_audiobook keeps its own checkpoint/resume — the
    queue just dispatches and records status."""
    doc_id = job["docId"]
    scope = job.get("realScope")
    voice = job.get("voice") or DEFAULT_VOICE
    summary = make_audiobook(doc_id, scope, voice, on_progress=ctx.progress)
    if summary.get("error"):
        return {"error": summary["error"]}
    return summary


def start_audiobook(doc_id: str | None, scope: str | None,
                    voice: str = DEFAULT_VOICE) -> dict:
    from app.gateways import enqueue_build

    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "error", "error": "no document found"}
    res = enqueue_build(doc_id, _audio_scope(scope), kind="audiobook",
                        payload={"realScope": scope, "voice": voice})
    if res.get("error"):
        return {"status": "error", "error": res["error"]}
    out = {"status": "running", "scope": scope, "docId": doc_id}
    if res.get("already"):
        out["alreadyRunning"] = True
    return out


def audiobook_status(doc_id: str | None, scope: str | None) -> dict:
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "idle", "scope": scope}
    try:
        _doc_dir(doc_id)
    except ValueError as exc:
        return {"status": "error", "scope": scope, "docId": doc_id, "error": str(exc)}
    # Live queue state (queued / running / error) takes precedence.
    job = _find_audiobook_job(doc_id, scope)
    if job and job.get("status") in ("queued", "running"):
        out = {"status": "running", "scope": scope, "docId": doc_id}
        if job.get("total"):
            out["progress"] = {"done": job.get("done"), "total": job.get("total"), "current": job.get("phase")}
        return out
    if job and job.get("status") == "error":
        return {"status": "error", "scope": scope, "docId": doc_id, "error": job.get("error")}
    # Done or no live job → the MP3 on disk is the source of truth (covers prior-run files).
    path = audiobook_path(doc_id, scope)
    if os.path.exists(path):
        return {"status": "done", "scope": scope, "docId": doc_id,
                "summary": {"file": path, "exists": True}}
    # There is no "interrupted" any more: a died-mid-render narration leaves nothing behind
    # to resume from, and at ~6s a chapter the answer to a dead run is simply to start it
    # again. That state used to exist because a lost run cost hours.
    return {"status": "idle", "scope": scope, "docId": doc_id}


def audiobook_timeline(doc_id: str | None, scope: str | None) -> dict:
    """Chunk→playback-time map for read-along highlighting.

    Narrations generated after timelines existed have an exact sidecar. Older MP3s get an
    ESTIMATED timeline: the script is deterministic, so the same segmentation is recomputed
    and per-chunk weights (∝ text length + gap) are returned for the client to scale to the
    real MP3 duration."""
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    try:
        tl_path = timeline_path(doc_id, scope)
    except ValueError as exc:
        return {"error": str(exc)}
    try:
        with open(tl_path) as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    if not os.path.exists(audiobook_path(doc_id, scope)):
        return {"error": "no audiobook for this scope"}
    try:
        segments = chapter_segments(doc_id, scope)
        deduped: list[str] = []
        for seg in segments:  # same dedup make_audiobook applies before synthesis
            if deduped and seg.strip().lower() == deduped[-1].strip().lower():
                continue
            deduped.append(seg)
        if not deduped:
            return {"error": "could not reconstruct the narration script"}
        weights = estimate_weights(deduped)
        return {
            "exact": False,
            "chunks": [{"text": s, "weight": w} for s, w in zip(deduped, weights)],
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def list_audiobooks(doc_id: str | None) -> dict:
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"docId": None, "audiobooks": []}
    try:
        folder = _doc_dir(doc_id)
    except ValueError as exc:
        return {"docId": doc_id, "audiobooks": [], "error": str(exc)}
    items = []
    if os.path.isdir(folder):
        for fn in sorted(os.listdir(folder)):
            if fn.endswith("__text.mp3"):
                items.append({"file": fn, "scope": fn[: -len("__text.mp3")]})
    return {"docId": doc_id, "audiobooks": items}
