"""Real-Postgres pack writes: the reweight job and the receipt merge.

v0.27.0 shipped ``receipt || %(r)s`` twice; psycopg's Json adapts to ``json``, Postgres has
no ``jsonb || json``, and every stubbed test passed. The reweight failed on prod and left the
pack in 'building'. This runs both writes against a real database.

Runs only when LEARN_PG_TESTS=1 (see conftest); otherwise skipped.
"""

from __future__ import annotations

import pytest

from app.gateways import db
from app.process.packs import author

pytestmark = pytest.mark.integration

PACK, UNIT, DOC = "pgtest-pack", "pgtest-unit", "pgtest-doc"


@pytest.fixture(autouse=True)
def _pack():
    def wipe() -> None:
        with db() as conn:
            conn.execute("DELETE FROM pack_items WHERE pack_key = %(p)s", {"p": PACK})
            conn.execute("DELETE FROM pack_units WHERE pack_key = %(p)s", {"p": PACK})
            conn.execute("DELETE FROM exam_packs WHERE key = %(p)s", {"p": PACK})
    wipe()
    with db() as conn:
        conn.execute("INSERT INTO exam_packs (key, doc_id, title, config, status, receipt) VALUES "
                     "(%(p)s, %(d)s, 'pg', '{\"scopeNotes\": \"stress A\"}'::jsonb, 'ready', '{\"kept\": 2}'::jsonb)",
                     {"p": PACK, "d": DOC})
        conn.execute('INSERT INTO pack_units (key, pack_key, section_key, title, "order", status, receipt) '
                     "VALUES (%(u)s, %(p)s, 's', 'Unit', 0, 'ready', '{\"kept\": 2, \"droppedCount\": 0}'::jsonb)",
                     {"u": UNIT, "p": PACK})
        for k, skill in (("pgtest-i1", "a"), ("pgtest-i2", "b")):
            conn.execute("INSERT INTO pack_items (key, pack_key, unit_key, skill, skill_label, weight, role, origin, "
                         "qtype, section_key, evidence, payload) VALUES (%(k)s, %(p)s, %(u)s, %(s)s, %(s)s, 1, "
                         "'exam', 'generated', 'mcq', 's', 'e', '{}'::jsonb)",
                         {"k": k, "p": PACK, "u": UNIT, "s": skill})
    yield
    wipe()


def test_reweight_writes_weights_and_merges_its_receipt(monkeypatch):
    monkeypatch.setattr(author, "_ask", lambda *a, **k: {"weights": [{"skillId": "a", "weight": 2.5, "reason": "notes"}]})
    out = author.reweight_pack(PACK)
    assert out["changes"] == 1 and out["failed"] == []
    with db() as conn:
        w = {r["skill"]: float(r["weight"]) for r in conn.execute(
            "SELECT skill, weight FROM pack_items WHERE pack_key = %(p)s", {"p": PACK}).fetchall()}
        p = conn.execute("SELECT status, receipt FROM exam_packs WHERE key = %(p)s", {"p": PACK}).fetchone()
    assert w == {"a": 2.5, "b": 1.0}
    assert p["status"] == "ready"
    assert p["receipt"]["kept"] == 2 and p["receipt"]["reweight"]["changes"][0]["to"] == 2.5


def test_a_crashing_reweight_still_leaves_the_pack_ready(monkeypatch):
    def boom(*a, **k):
        raise KeyboardInterrupt  # escapes the per-chapter except, like a worker kill would
    monkeypatch.setattr(author, "_reweight_units", boom)
    with pytest.raises(KeyboardInterrupt):
        author.reweight_pack(PACK)
    with db() as conn:
        assert conn.execute("SELECT status FROM exam_packs WHERE key = %(p)s", {"p": PACK}).fetchone()["status"] == "ready"


def test_finalize_keeps_the_reweight_receipt():
    with db() as conn:
        conn.execute("UPDATE exam_packs SET receipt = '{\"reweight\": {\"notes\": \"x\"}}'::jsonb WHERE key = %(p)s", {"p": PACK})
    totals = author.finalize_pack(PACK)
    with db() as conn:
        r = conn.execute("SELECT receipt FROM exam_packs WHERE key = %(p)s", {"p": PACK}).fetchone()["receipt"]
    assert totals["kept"] == 2 and r["kept"] == 2 and r["reweight"] == {"notes": "x"}
