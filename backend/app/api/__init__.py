"""API — thin HTTP routers over the domains, one file per area of the app.

Owns: eight routers mirroring the package groups — content (the book), process
(convert/extract/build), concepts (read + curate), reading, study (doing),
progress (tracking), media (audiobook), system (machine strip). No business
logic: routers validate, call a domain facade, shape the JSON envelope.
``all_routers`` is what main.py mounts. Depends on: every domain; nothing
imports api except main.py.
"""

from app.api.concept_routes import router as _concept_routes
from app.api.content_routes import router as _content_routes
from app.api.media_routes import router as _media_routes
from app.api.practice_routes import router as _practice_routes
from app.api.process_routes import router as _process_routes
from app.api.progress_routes import router as _progress_routes
from app.api.reading_routes import router as _reading_routes
from app.api.study_routes import router as _study_routes
from app.api.system_routes import router as _system_routes

all_routers = [
    _concept_routes,
    _content_routes,
    _media_routes,
    _practice_routes,
    _process_routes,
    _progress_routes,
    _reading_routes,
    _study_routes,
    _system_routes,
]
