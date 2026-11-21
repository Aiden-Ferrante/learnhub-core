"""Process — everything that turns an uploaded PDF into studyable content.

Groups the three stages of the document-processing side of the app, each still
its own package with its own facade (import those, not this):

- ``app.process.ingestion``  — PDF in (conversion to markdown)
- ``app.process.content``    — the book itself (sections, pages, outline, scope)
- ``app.process.extraction`` — LLM generation passes over stored content

This package is a namespace only; it re-exports nothing.
"""
