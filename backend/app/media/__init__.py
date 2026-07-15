"""Media — audio renditions of chapters.

Owns: audiobook generation with checkpoint/resume and read-along timelines
(audiobook) and the Orpheus TTS client (tts_orpheus). Depends on: content,
platform.
"""

from app.media.audiobook import audiobook_path, audiobook_status, audiobook_timeline, list_audiobooks, run_audiobook, start_audiobook, timeline_path
from app.media.tts_orpheus import VOICES

__all__ = [
    "VOICES",
    "audiobook_path",
    "audiobook_status",
    "audiobook_timeline",
    "list_audiobooks",
    "run_audiobook",
    "start_audiobook",
    "timeline_path",
]
