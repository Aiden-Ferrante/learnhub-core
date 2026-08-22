"""Kokoro-82M text-to-speech, in-process on the GPU.

Replaces the Orpheus 3B + SNAC pipeline. Orpheus was an autoregressive LLM emitting 7
discrete audio tokens per frame, so every frame of audio cost a full transformer decode;
Kokoro is a non-autoregressive 82M model that produces the waveform directly. Measured on
this GB10, same chapter, end to end: Orpheus 132.7s (2.40x realtime, using 8 concurrent
streams), Kokoro 5.6s (50-52x, one stream). See docs/adr/0002-kokoro-replaces-orpheus-tts.md.

The interface is deliberately identical to the module it replaces — ``synthesize(text,
voice) -> float32 mono waveform`` — so the swap does not reach into ``make_audiobook``.

ONE STREAM IS CORRECT. Measured 50.4x / 51.9x / 49.0x at 1 / 4 / 8 concurrent streams:
concurrency is flat because a single stream already saturates the chip. Do not add a worker
pool. (The pipeline is also not thread-safe — it holds per-call state — so a pool would need
one instance per thread, each paying a ~2s model load, which is how the first benchmark of
this managed to look *slower* in parallel.)
"""

from __future__ import annotations

import logging
import os
import threading

import numpy as np

SAMPLE_RATE = 24000

# Kokoro's own model card grades its voices; af_bella is the only A. af_nicole is excluded
# on measurement rather than taste — it read a technical paragraph in 37.4s where the others
# took 21-27s (it is the breathy "headphones" voice), which is wrong for hour-long narration.
DEFAULT_VOICE = "af_bella"
VOICES = (
    "af_bella", "af_heart", "af_aoede", "af_kore", "af_sarah", "af_nova",
    "af_alloy", "af_sky", "am_michael", "am_fenrir", "am_puck",
    "bf_emma", "bf_isabella", "bm_fable", "bm_george",
)

_LANG_CODE = os.environ.get("KOKORO_LANG", "a")  # 'a' = American English

_pipeline = None
_lock = threading.Lock()


def _get_pipeline():
    """The one shared KPipeline, built on first use.

    Import is deferred: kokoro pulls torch and a spaCy G2P model, and the API process should
    not pay that unless something actually narrates.
    """
    global _pipeline
    if _pipeline is None:
        with _lock:
            if _pipeline is None:
                import torch
                from kokoro import KPipeline

                device = "cuda" if torch.cuda.is_available() else "cpu"
                _pipeline = KPipeline(lang_code=_LANG_CODE, device=device)
    return _pipeline


def warm_tts() -> None:
    """Build the pipeline and run one throwaway synthesis, off the request path.

    Measured: a fresh container's first narration takes ~19s against ~5.4s warm — the
    difference is torch/CUDA init plus the model and G2P load, paid once per process. The
    weights are baked into the image, so this touches no network; it just moves a one-time
    cost off whichever narration happens to be first. Best-effort by design: a failure here
    must not stop the worker starting, and the real call will surface the error properly.
    """
    try:
        synthesize("Warming the narrator.")
    except Exception:
        logging.getLogger(__name__).warning("TTS warm-up failed; first narration will be slow", exc_info=True)


def synthesize(text: str, voice: str = DEFAULT_VOICE, retries: int = 1) -> np.ndarray:
    """One text chunk → float32 mono 24 kHz waveform.

    Returns an empty array only when the text has nothing speakable in it. ``retries`` is
    kept for interface compatibility with the Orpheus engine, where a dud generation was
    routine; Kokoro is deterministic and does not emit duds, so one attempt is the default.
    """
    if not text or not text.strip():
        return np.zeros(0, dtype=np.float32)
    if voice not in VOICES:
        voice = DEFAULT_VOICE

    for attempt in range(retries + 1):
        try:
            # KPipeline splits long text internally and yields one Result per piece; the
            # caller wants a single waveform for the chunk it asked about.
            parts = [
                r.audio.detach().cpu().numpy()
                for r in _get_pipeline()(text, voice=voice)
                if r.audio is not None
            ]
        except Exception:
            if attempt >= retries:
                raise
            continue
        parts = [p for p in parts if p.size]
        if parts:
            return np.concatenate(parts).astype(np.float32)
    return np.zeros(0, dtype=np.float32)
