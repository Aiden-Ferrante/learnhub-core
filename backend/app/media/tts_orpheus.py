"""Orpheus 3B text-to-speech via the local Ollama server + a SNAC 24 kHz decoder.

Orpheus is an LLM that emits discrete audio tokens (``<custom_token_N>``); SNAC
decodes 7-token frames into a 24 kHz waveform. We drive Orpheus through the existing
Ollama (OpenAI-compatible ``/v1/completions``) so no extra model server is needed —
keyless and fully local.

The token parse is the reference's self-synchronizing scheme: a token is kept only if
``number - 10 - ((kept_count % 7) * 4096)`` lands in a valid SNAC code range (>0); the
preamble / non-audio tokens fall out automatically and the 7-token frame alignment holds.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request

import numpy as np

SAMPLE_RATE = 24000
DEFAULT_VOICE = "tara"
# Orpheus-FT preset voices, roughly best→worst per the model card.
VOICES = ("tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe")

_MODEL = os.environ.get(
    "ORPHEUS_MODEL", "hf.co/isaiahbjork/orpheus-3b-0.1-ft-Q4_K_M-GGUF"
)
_TOKEN_RE = re.compile(r"<custom_token_(\d+)>")


def _generate_url() -> str:
    from app.platform import ollama_base_url

    return ollama_base_url() + "/api/generate"


def orpheus_token_text(text: str, voice: str = DEFAULT_VOICE, max_tokens: int = 3072,
                       timeout: float = 600.0) -> str:
    """Ask Orpheus (via Ollama) for the raw ``<custom_token_N>`` stream for one chunk.

    CRITICAL: use the NATIVE ``/api/generate`` with ``raw: true``. The OpenAI-compat
    ``/v1/completions`` applies the model's chat template, which derails Orpheus into
    generating TEXT (hallucinated dialogue) instead of audio tokens on most real
    sentences. ``raw: true`` sends the prompt verbatim so it stays in audio mode.
    """
    prompt = f"<|audio|>{voice}: {text}<|eot_id|>"
    payload = {
        "model": _MODEL,
        "prompt": prompt,
        "raw": True,
        "stream": False,
        "options": {
            "temperature": 0.6,
            "top_p": 0.9,
            "repeat_penalty": 1.1,
            "num_predict": max_tokens,
        },
    }
    req = urllib.request.Request(
        _generate_url(),
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.load(resp)
    return data.get("response", "")


def parse_audio_ids(token_text: str) -> list[int]:
    """Self-synchronizing parse → flat list of SNAC code ids (frame-aligned, len % 7 == 0)."""
    ids: list[int] = []
    count = 0
    for m in _TOKEN_RE.finditer(token_text):
        tid = int(m.group(1)) - 10 - ((count % 7) * 4096)
        if tid > 0:
            ids.append(tid)
            count += 1
    usable = (len(ids) // 7) * 7
    return ids[:usable]


_snac = None


def _get_snac():
    global _snac
    if _snac is None:
        import torch
        from snac import SNAC

        model = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval()
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        _snac = (model.to(dev), dev)
    return _snac


def decode_ids(ids: list[int]) -> np.ndarray:
    """SNAC-decode frame-aligned ids → float32 mono 24 kHz waveform in [-1, 1]."""
    import torch

    n = len(ids) // 7
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    c0: list[int] = []
    c1: list[int] = []
    c2: list[int] = []
    for j in range(n):
        f = ids[7 * j : 7 * j + 7]
        if any(x < 0 or x > 4095 for x in f):
            continue  # drop a corrupt frame rather than poison the whole decode
        c0.append(f[0])
        c1.append(f[1]); c1.append(f[4])
        c2.append(f[2]); c2.append(f[3]); c2.append(f[5]); c2.append(f[6])
    if not c0:
        return np.zeros(0, dtype=np.float32)
    model, dev = _get_snac()
    codes = [
        torch.tensor(c0, device=dev, dtype=torch.long).unsqueeze(0),
        torch.tensor(c1, device=dev, dtype=torch.long).unsqueeze(0),
        torch.tensor(c2, device=dev, dtype=torch.long).unsqueeze(0),
    ]
    with torch.inference_mode():
        audio = model.decode(codes)
    return audio.squeeze().detach().cpu().numpy().astype(np.float32)


def synthesize(text: str, voice: str = DEFAULT_VOICE, retries: int = 2) -> np.ndarray:
    """One text chunk → float32 mono 24 kHz waveform. Orpheus occasionally emits a dud
    (no audio frames); retry a couple of times before giving up on the chunk."""
    for _ in range(retries + 1):
        ids = parse_audio_ids(orpheus_token_text(text, voice=voice))
        if len(ids) >= 7:
            wav = decode_ids(ids)
            if wav.size:
                return wav
    return np.zeros(0, dtype=np.float32)
