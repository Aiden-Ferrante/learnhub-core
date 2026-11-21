"""Exam packs: thin routes over supplemental/study/packs."""

from __future__ import annotations

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.supplemental.study import packs

router = APIRouter()


def _out(data: dict) -> JSONResponse:
    return JSONResponse(data, status_code=400 if data.get("error") else 200)


@router.get("/api/packs")
def api_packs(doc: str | None = Query(None)) -> JSONResponse:
    return _out(packs.list_packs(doc))


@router.post("/api/packs")
def api_pack_create(body: dict = Body(...)) -> JSONResponse:
    return _out(packs.create_pack(body.get("doc"), str(body.get("title") or ""),
                                  body.get("chapters") or [], body.get("format"),
                                  str(body.get("scopeNotes") or ""), body.get("examDate")))


@router.get("/api/packs/presets")
def api_presets(doc: str | None = Query(None)) -> JSONResponse:
    return _out(packs.presets(doc))


@router.post("/api/packs/presets")
def api_preset_save(body: dict = Body(...)) -> JSONResponse:
    return _out(packs.save_preset(body.get("doc"), str(body.get("name") or "Default"),
                                  body.get("format") or {}))


@router.get("/api/packs/{key}")
def api_pack(key: str) -> JSONResponse:
    return _out(packs.get_pack(key))


@router.get("/api/packs/{key}/today")
def api_today(key: str) -> JSONResponse:
    return _out(packs.today(key))


@router.get("/api/packs/{key}/review")
def api_review(key: str) -> JSONResponse:
    return _out(packs.review_set(key))


@router.get("/api/packs/{key}/units/{unit}")
def api_unit(key: str, unit: str) -> JSONResponse:
    return _out(packs.learn_unit(key, unit))


@router.post("/api/packs/{key}/units/{unit}/progress")
def api_progress(key: str, unit: str, body: dict = Body(...)) -> JSONResponse:
    return _out(packs.set_progress(key, unit, body or {}))


@router.post("/api/packs/{key}/notes")
def api_notes(key: str, body: dict = Body(...)) -> JSONResponse:
    """Change the scope notes of a built pack and reweight its skills (no rebuild)."""
    return _out(packs.set_scope_notes(key, str(body.get("scopeNotes") or "")))


@router.post("/api/packs/{key}/grade")
def api_grade(key: str, body: dict = Body(...)) -> JSONResponse:
    return _out(packs.grade_learn(key, str(body.get("skill") or ""), bool(body.get("correct"))))


@router.post("/api/packs/{key}/sittings")
def api_sit(key: str) -> JSONResponse:
    return _out(packs.start_sitting(key))


@router.get("/api/sittings/{key}")
def api_sitting(key: str) -> JSONResponse:
    return _out(packs.fetch_sitting(key))


@router.post("/api/sittings/{key}/answer")
def api_answer(key: str, body: dict = Body(...)) -> JSONResponse:
    return _out(packs.save_answer(key, str(body.get("questionKey") or ""), body.get("answer") or {}))


@router.post("/api/sittings/{key}/finish")
def api_finish(key: str) -> JSONResponse:
    return _out(packs.finish_sitting(key))


@router.post("/api/sittings/{key}/mark")
def api_mark(key: str, body: dict = Body(...)) -> JSONResponse:
    try:
        grade = int(body.get("grade"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "grade must be 1-4"}, status_code=400)
    return _out(packs.mark_written(key, str(body.get("questionKey") or ""), grade))


@router.get("/api/sittings/{key}/results")
def api_results(key: str) -> JSONResponse:
    return _out(packs.results(key))
