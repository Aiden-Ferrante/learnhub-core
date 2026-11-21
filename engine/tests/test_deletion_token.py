"""The course delete route refuses without the token its deletion read issued
(v0.22.0). Fixture-free: an invalid id never reaches Postgres, so the gate's own
sentence is what is under test; the DB-backed shape is in test_delete_pg."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import tokens
from app.api.content_routes import router



def _client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_a_bare_delete_is_refused_and_names_the_read():
    tokens._reset()
    r = _client().delete("/api/document", params={"doc": "not-a-doc-id!"})
    assert r.status_code == 422, r.text
    assert "GET /api/document/deletion" in r.json()["error"]


def test_a_token_for_another_course_is_refused_by_name():
    tokens._reset()
    t = tokens.issue("course-delete", "deadbeef", {"x": 1})
    r = _client().delete("/api/document", params={"doc": "not-a-doc-id!", "token": t})
    assert r.status_code == 422 and "different course-delete" in r.json()["error"]


def test_the_deletion_read_refuses_a_bad_id_without_a_token():
    r = _client().get("/api/document/deletion", params={"doc": "not-a-doc-id!"})
    assert r.status_code == 400 and "token" not in r.json()
