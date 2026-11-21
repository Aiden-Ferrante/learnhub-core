"""Media — audio renditions of chapters.

Owns: audiobook generation with read-along timelines (audiobook) and the Kokoro TTS
engine (tts_kokoro). Depends on: content, gateways.
"""

from app.supplemental.media.audiobook import audiobook_path, audiobook_status, audiobook_timeline, list_audiobooks, remove_audiobooks, run_audiobook, start_audiobook
from app.supplemental.media.tts_kokoro import DEFAULT_VOICE, VOICES, warm_tts

__all__ = [
    "DEFAULT_VOICE",
    "VOICES",
    "warm_tts",
    "audiobook_path",
    "audiobook_status",
    "audiobook_timeline",
    "list_audiobooks",
    "remove_audiobooks",
    "run_audiobook",
    "start_audiobook",
]
