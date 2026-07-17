"""Media — audio renditions of chapters.

Owns: audiobook generation with checkpoint/resume and read-along timelines
(audiobook) and the Orpheus TTS client (tts_orpheus). Depends on: content,
gateways.
"""

from app.supplemental.media.audiobook import audiobook_path, audiobook_status, audiobook_timeline, list_audiobooks, run_audiobook, start_audiobook
from app.supplemental.media.tts_orpheus import VOICES

__all__ = [
    "VOICES",
    "audiobook_path",
    "audiobook_status",
    "audiobook_timeline",
    "list_audiobooks",
    "run_audiobook",
    "start_audiobook",
]
