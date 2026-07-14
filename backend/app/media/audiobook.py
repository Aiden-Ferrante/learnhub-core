"""Audiobook generation: a chapter (or section) → a downloadable MP3 narrated by a
local Orpheus 3B voice (via Ollama) + SNAC decode.

Two sources (chosen per chapter):
  - "text"     : the chapter's source markdown, cleaned for narration.
  - "concepts" : the chapter's extracted concept signals (a clean audio summary).

Long-running and GPU-bound, so it runs as a background job (mirrors the extraction
job): ``POST /api/audiobook`` starts it, the client polls ``/status``, then streams /
downloads the MP3 from ``/file``.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time

import numpy as np

from app.content.arango_content import fetch_latest_document
from app.platform.arango import connect_arango
from app.extraction.extract import _load_section_blocks
from app.platform.llm import ollama_structured_completion
from app.platform.llm_schemas import GuidedScript
from app.media.tts_orpheus import DEFAULT_VOICE, SAMPLE_RATE, VOICES, synthesize

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
    Orpheus drifts on long passages, so keep each generation small."""
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
# Source text (text | concepts)
# --------------------------------------------------------------------------- #

def _scope_segments_text(db, doc_id: str, scope: str | None) -> list[str]:
    """Chapter's source markdown (per section, heading first), cleaned + segmented."""
    sections = _load_section_blocks(db, doc_id, scope=scope)
    segs: list[str] = []
    for s in sections:
        heading = (s.heading or "").strip()
        if heading and not heading.lower().startswith("toc:"):
            segs.append(f"{re.sub(r'[*_`#]', '', heading).strip()}.")
        segs.extend(segment_text(clean_for_narration(s.markdown)))
    return segs


def _scope_section_keys(db, doc_id: str, scope: str | None) -> list[str]:
    return [s.section_key for s in _load_section_blocks(db, doc_id, scope=scope)]


def _scope_segments_concepts(db, doc_id: str, scope: str | None) -> list[str]:
    """Chapter's concept lessons as a clean audio summary, in reading order."""
    keys = _scope_section_keys(db, doc_id, scope)
    if not keys:
        return []
    rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks "
            "SORT c.sectionKey, c.order RETURN {name: c.name, signal: c.signal}",
            bind_vars={"d": doc_id, "ks": keys},
        )
    )
    segs: list[str] = []
    for r in rows:
        name = (r.get("name") or "").strip()
        signal = clean_for_narration(r.get("signal") or "")
        if name and signal:
            segs.append(f"{name}.")
            segs.extend(segment_text(signal))
    return segs


# --------------------------------------------------------------------------- #
# Guided narration: read the text verbatim, wrapped in concept-grounded tutoring.
# --------------------------------------------------------------------------- #

GUIDED_SYSTEM = (
    "You are a warm, concise tutor narrating a textbook section as AUDIO. You are given the "
    "section's passages (numbered from 0) and its key concepts. Produce guidance that wraps "
    "AROUND the passages — never rewrite, quote, or summarize them.\n"
    "- intro: ONE spoken sentence orienting the listener (what this section is about, why it "
    "matters).\n"
    "- comments: a few SHORT tutor asides, each placed after a specific passage index, only where "
    "genuinely helpful (connect ideas, flag what matters, relate to a key concept). Write each in "
    "an explicit tutor voice ('Notice that…', 'The key idea here is…', 'In other words…') so a "
    "listener clearly hears it's commentary, not the book. One sentence each; at most one per "
    "passage; 2–4 total.\n"
    "- takeaways: 2–4 short 'remember this' points, grounded in the concepts.\n"
    "Spoken style only — no markdown, no symbols or equations read aloud, no passage numbers. "
    "Ground everything in the given passages and concepts; invent nothing."
)


def _spoken(s: object) -> str:
    return re.sub(r"[*_`#]", "", str(s or "")).strip()


def _concepts_for_section(db, doc_id: str, section_key: str) -> list[dict]:
    return list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey == @s SORT c.order "
            "RETURN {name: c.name, signal: c.signal}",
            bind_vars={"d": doc_id, "s": section_key},
        )
    )


def _guided_script_for_section(heading: str, passages: list[str], concepts: list[dict],
                               model: str | None = None) -> dict | None:
    concept_lines = "\n".join(f"- {c['name']}: {c.get('signal') or ''}" for c in concepts[:12])
    numbered = "\n".join(f"[{i}] {p}" for i, p in enumerate(passages))
    user = (
        f"Section: {heading}\n\n"
        f"Key concepts:\n{concept_lines or '(none extracted)'}\n\n"
        f"Passages:\n{numbered}"
    )
    messages = [
        {"role": "system", "content": GUIDED_SYSTEM},
        {"role": "user", "content": user},
    ]
    obj, _err = ollama_structured_completion(messages, GuidedScript, temperature=0.4, model=model)
    return obj if isinstance(obj, dict) else None


def _scope_segments_guided(db, doc_id: str, scope: str | None, model=None, on_progress=None) -> list[str]:
    """Verbatim passages spliced with concept-grounded tutor scaffolding (single voice).
    All LLM script-writing happens here, BEFORE any TTS, so the single-GPU model cache
    swaps once (script model → Orpheus) instead of per section."""
    sections = _load_section_blocks(db, doc_id, scope=scope)
    out: list[str] = []
    for si, s in enumerate(sections):
        if on_progress:
            on_progress(si, len(sections), f"writing guide: {(s.heading or '')[:50]}")
        passages = segment_text(clean_for_narration(s.markdown))
        if not passages:
            continue
        head = _spoken(s.heading)
        if head and not head.lower().startswith("toc:"):
            out.append(f"{head}.")
        script = _guided_script_for_section(
            head or s.section_key, passages, _concepts_for_section(db, doc_id, s.section_key), model
        )
        comments_by: dict[int, list[str]] = {}
        intro, takeaways = "", []
        if script:
            intro = _spoken(script.get("intro"))
            for c in script.get("comments") or []:
                note = _spoken(c.get("note"))
                if note:
                    comments_by.setdefault(int(c.get("after", -1)), []).append(note)
            takeaways = [t for t in (_spoken(x) for x in script.get("takeaways") or []) if t]
        if intro:
            out.append(intro)
        for i, p in enumerate(passages):
            out.append(p)
            for note in comments_by.get(i, []):
                out.append(note)
        if takeaways:
            out.append("To sum up. " + " ".join(t.rstrip(".") + "." for t in takeaways))
    return out


def chapter_segments(db, doc_id: str, scope: str | None, source: str, on_progress=None) -> list[str]:
    if source == "concepts":
        return _scope_segments_concepts(db, doc_id, scope)
    if source == "guided":
        return _scope_segments_guided(db, doc_id, scope, on_progress=on_progress)
    return _scope_segments_text(db, doc_id, scope)


# --------------------------------------------------------------------------- #
# Synthesis + MP3
# --------------------------------------------------------------------------- #

def _slug(scope: str | None) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", scope or "whole").strip("-") or "whole"


def audiobook_path(doc_id: str, scope: str | None, source: str) -> str:
    return os.path.join(AUDIO_DIR, doc_id, f"{_slug(scope)}__{source}.mp3")


def timeline_path(doc_id: str, scope: str | None, source: str) -> str:
    """Sidecar mapping narration chunks to playback times — the read-along data."""
    return os.path.join(AUDIO_DIR, doc_id, f"{_slug(scope)}__{source}.timeline.json")


def estimate_weights(segments: list[str], gap_sec: float = 0.35, chars_per_sec: float = 14.0) -> list[float]:
    """Relative duration weights for chunks whose real audio timing is unknown (MP3s
    generated before timelines existed). Speech time ≈ chars/rate, plus the fixed
    inter-chunk gap — the client scales these to the actual MP3 duration."""
    return [max(1.0, len(s)) / chars_per_sec + gap_sec for s in segments]


# One narration synthesizes at a time: every chunk goes through the single shared GPU
# (Orpheus via Ollama), so concurrent jobs would interleave and all finish late. Extra
# jobs queue on this gate and run in POST order.
_TTS_GATE = threading.Semaphore(1)


def _work_dir(doc_id: str, scope: str | None, source: str) -> str:
    return os.path.join(AUDIO_DIR, doc_id, f".{_slug(scope)}__{source}.work")


def _load_manifest(work: str) -> dict | None:
    try:
        with open(os.path.join(work, "manifest.json")) as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        return None
    segments = manifest.get("segments")
    return manifest if isinstance(segments, list) and segments else None


def _save_chunk(path: str, wav: np.ndarray) -> None:
    tmp = f"{path}.tmp.npy"
    np.save(tmp, wav)
    os.replace(tmp, path)


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


def make_audiobook(doc_id: str | None, scope: str | None, source: str = "text",
                   voice: str = DEFAULT_VOICE, on_progress=None) -> dict:
    """Render a chapter to an MP3. Blocking + GPU-bound — call from a worker thread.

    Every synthesized chunk is checkpointed to a work dir, so a job that dies mid-way
    (service restart, crash) resumes from the last finished chunk on the next request
    instead of losing hours of GPU time."""
    t0 = time.time()
    db = connect_arango()
    if doc_id is None:
        doc = (fetch_latest_document() or {}).get("document")
        doc_id = doc.get("id") if doc else None
    if not doc_id:
        return {"error": "no document found"}
    if voice not in VOICES:
        voice = DEFAULT_VOICE

    # Resume from the checkpointed segment list when one exists — it pins the exact
    # narration script (guided scripts are LLM-written, so recomputing would drift)
    # and the voice, so resumed chunks match the ones already on disk.
    work = _work_dir(doc_id, scope, source)
    manifest = _load_manifest(work)
    if manifest:
        segments = manifest["segments"]
        if manifest.get("voice") in VOICES:
            voice = manifest["voice"]
    else:
        segments = chapter_segments(db, doc_id, scope, source, on_progress=on_progress)
        # Drop consecutive duplicates (e.g. a heading that the section body repeats).
        deduped: list[str] = []
        for seg in segments:
            if deduped and seg.strip().lower() == deduped[-1].strip().lower():
                continue
            deduped.append(seg)
        segments = deduped
        if not segments:
            return {"docId": doc_id, "scope": scope, "error": "no narratable text in this scope"}
        os.makedirs(work, exist_ok=True)
        tmp = os.path.join(work, "manifest.json.tmp")
        with open(tmp, "w") as f:
            json.dump({"segments": segments, "voice": voice}, f)
        os.replace(tmp, os.path.join(work, "manifest.json"))

    total = len(segments)

    if not _TTS_GATE.acquire(blocking=False):
        if on_progress:
            on_progress(0, total, "queued — another narration is synthesizing")
        _TTS_GATE.acquire()
    try:
        if on_progress:
            on_progress(0, total, "resuming from checkpoint" if manifest else None)
        pieces: list[np.ndarray] = []
        # Exact per-chunk playback times (the read-along timeline) fall out of the concat
        # for free — capture them here, while the sample counts are in hand.
        chunk_times: list[dict] = []
        cursor = 0
        for i, seg in enumerate(segments):
            chunk = os.path.join(work, f"{i:05d}.npy")
            wav = None
            if os.path.exists(chunk):
                try:
                    wav = np.load(chunk)
                except (OSError, ValueError):
                    wav = None  # unreadable checkpoint → resynthesize
            if wav is None:
                wav = synthesize(seg, voice=voice)
                _save_chunk(chunk, wav)
            if wav.size:
                start = cursor / SAMPLE_RATE
                cursor += wav.size
                chunk_times.append({"text": seg, "start": round(start, 3),
                                    "end": round(cursor / SAMPLE_RATE, 3)})
                cursor += _GAP.size
                pieces.append(wav)
                pieces.append(_GAP)
            if on_progress:
                on_progress(i + 1, total, seg[:60])
    finally:
        _TTS_GATE.release()

    if not pieces:
        return {"docId": doc_id, "scope": scope, "error": "synthesis produced no audio"}

    full = np.concatenate(pieces)
    out_path = audiobook_path(doc_id, scope, source)
    _encode_mp3(full, out_path)
    tl_path = timeline_path(doc_id, scope, source)
    tmp_tl = f"{tl_path}.tmp"
    with open(tmp_tl, "w") as f:
        json.dump({"exact": True, "source": source, "chunks": chunk_times}, f)
    os.replace(tmp_tl, tl_path)
    shutil.rmtree(work, ignore_errors=True)

    return {
        "docId": doc_id,
        "scope": scope,
        "source": source,
        "voice": voice,
        "segments": total,
        "durationSec": round(full.size / SAMPLE_RATE, 1),
        "file": out_path,
        "seconds": round(time.time() - t0, 1),
    }


# --------------------------------------------------------------------------- #
# Background job (mirrors extract._JOBS)
# --------------------------------------------------------------------------- #

_JOBS: dict[str, dict] = {}


def _job_key(doc_id: str, scope: str | None, source: str) -> str:
    return f"{doc_id}:{scope or 'ALL'}:{source}"


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


async def _run_job(key: str, doc_id: str, scope: str | None, source: str, voice: str) -> None:
    def on_progress(done: int, total: int, current: str | None) -> None:
        job = _JOBS.get(key)
        if job and job.get("status") == "running":
            job["progress"] = {"done": done, "total": total, "current": current}

    try:
        summary = await asyncio.to_thread(
            make_audiobook, doc_id, scope, source, voice, on_progress
        )
        if summary.get("error"):
            _JOBS[key] = {"status": "error", "scope": scope, "docId": doc_id,
                          "source": source, "error": summary["error"]}
        else:
            _JOBS[key] = {"status": "done", "scope": scope, "docId": doc_id,
                          "source": source, "summary": summary}
    except Exception as exc:  # noqa: BLE001 — surface in status, never crash the loop
        _JOBS[key] = {"status": "error", "scope": scope, "docId": doc_id,
                      "source": source, "error": str(exc)}


def start_audiobook(doc_id: str | None, scope: str | None, source: str = "text",
                    voice: str = DEFAULT_VOICE) -> dict:
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "error", "error": "no document found"}
    key = _job_key(doc_id, scope, source)
    current = _JOBS.get(key)
    if current and current.get("status") == "running":
        return {"status": "running", "scope": scope, "docId": doc_id, "source": source,
                "alreadyRunning": True}
    _JOBS[key] = {"status": "running", "scope": scope, "docId": doc_id, "source": source}
    asyncio.create_task(_run_job(key, doc_id, scope, source, voice))
    return {"status": "running", "scope": scope, "docId": doc_id, "source": source}


def audiobook_status(doc_id: str | None, scope: str | None, source: str = "text") -> dict:
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "idle", "scope": scope, "source": source}
    key = _job_key(doc_id, scope, source)
    job = _JOBS.get(key)
    if job:
        return job
    # Not running this session, but a file may already exist from a prior run.
    path = audiobook_path(doc_id, scope, source)
    if os.path.exists(path):
        return {"status": "done", "scope": scope, "docId": doc_id, "source": source,
                "summary": {"file": path, "exists": True}}
    # A checkpoint work dir without a job means a run died (e.g. service restart);
    # starting the narration again resumes from the last finished chunk.
    work = _work_dir(doc_id, scope, source)
    manifest = _load_manifest(work)
    if manifest:
        done = sum(1 for fn in os.listdir(work)
                   if fn.endswith(".npy") and not fn.endswith(".tmp.npy"))
        return {"status": "interrupted", "scope": scope, "docId": doc_id, "source": source,
                "progress": {"done": done, "total": len(manifest["segments"]), "current": None},
                "resume": "start this narration again to continue from the checkpoint"}
    return {"status": "idle", "scope": scope, "docId": doc_id, "source": source}


def audiobook_timeline(doc_id: str | None, scope: str | None, source: str = "text") -> dict:
    """Chunk→playback-time map for read-along highlighting.

    Narrations generated after timelines existed have an exact sidecar. Older MP3s get an
    ESTIMATED timeline when the narration script is deterministic (text/concepts): the same
    segmentation is recomputed and per-chunk weights (∝ text length + gap) are returned for
    the client to scale to the real MP3 duration. Guided scripts were LLM-written and can't
    be reconstructed — no sidecar means no read-along there."""
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    tl_path = timeline_path(doc_id, scope, source)
    try:
        with open(tl_path) as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    if not os.path.exists(audiobook_path(doc_id, scope, source)):
        return {"error": "no audiobook for this scope"}
    if source == "guided":
        return {"error": "no timeline for this narration (guided script predates timelines — regenerate)"}
    try:
        db = connect_arango()
        segments = chapter_segments(db, doc_id, scope, source)
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
            "source": source,
            "chunks": [{"text": s, "weight": w} for s, w in zip(deduped, weights)],
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def list_audiobooks(doc_id: str | None) -> dict:
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"docId": None, "audiobooks": []}
    folder = os.path.join(AUDIO_DIR, doc_id)
    items = []
    if os.path.isdir(folder):
        for fn in sorted(os.listdir(folder)):
            if fn.endswith(".mp3"):
                stem = fn[:-4]
                scope_slug, _, source = stem.rpartition("__")
                items.append({"file": fn, "scope": scope_slug, "source": source or "text"})
    return {"docId": doc_id, "audiobooks": items}
