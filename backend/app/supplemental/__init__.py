"""Supplemental — what the app layers on top of processed content.

Groups the study-and-enrichment side of the app; each is still its own package
with its own facade (import those, not this):

- ``app.supplemental.study`` — the learning loop (reviews, quizzes, mastery, exams)
- ``app.supplemental.media`` — audiobook TTS generation

This package is a namespace only; it re-exports nothing.
"""
