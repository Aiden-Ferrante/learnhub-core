"""API — thin HTTP routers over the domains.

Owns: one router module per surface; no business logic (routers validate, call a
domain function, shape the JSON envelope). ``all_routers`` is what main.py mounts.
Depends on: every domain; nothing imports api except main.py."""

from app.api.admin_routes import router as _admin_routes
from app.api.audiobook_routes import router as _audiobook_routes
from app.api.build_routes import router as _build_routes
from app.api.concept_study_routes import router as _concept_study_routes
from app.api.content_routes import router as _content_routes
from app.api.deep_chapter_routes import router as _deep_chapter_routes
from app.api.extract_routes import router as _extract_routes
from app.api.ingest_routes import router as _ingest_routes
from app.api.learning_path_routes import router as _learning_path_routes
from app.api.mastery_routes import router as _mastery_routes
from app.api.reading_routes import router as _reading_routes
from app.api.search_routes import router as _search_routes
from app.api.study_routes import router as _study_routes
from app.api.system_routes import router as _system_routes

all_routers = [
    _admin_routes,
    _audiobook_routes,
    _build_routes,
    _concept_study_routes,
    _content_routes,
    _deep_chapter_routes,
    _extract_routes,
    _ingest_routes,
    _learning_path_routes,
    _mastery_routes,
    _reading_routes,
    _search_routes,
    _study_routes,
    _system_routes,
]
