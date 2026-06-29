"""Unit tests for the Learn hub's vault seam client (no network)."""
import asyncio
import importlib

import app.seedling_client as sc


def _reload(monkeypatch, url):
    monkeypatch.setenv("VAULTWRITER_URL", url)
    return importlib.reload(sc)


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _FakeClient:
    last_post = None

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json):
        _FakeClient.last_post = (url, json)
        return _FakeResp({"path": "_Review/Seedlings/x.md"})


def test_noop_when_unconfigured(monkeypatch):
    mod = _reload(monkeypatch, "")
    assert mod.configured() is False
    assert asyncio.run(mod.emit_seedling("anything")) is None


def test_noop_on_empty_opener(monkeypatch):
    mod = _reload(monkeypatch, "http://host.docker.internal:8799")
    assert asyncio.run(mod.emit_seedling("   ")) is None


def test_posts_payload_and_returns_path(monkeypatch):
    mod = _reload(monkeypatch, "http://host.docker.internal:8799")
    monkeypatch.setattr(mod.httpx, "AsyncClient", _FakeClient)
    path = asyncio.run(mod.emit_seedling(
        "Idea.", expansion="ctx", links=["A"], source="sec 1.2"))
    assert path == "_Review/Seedlings/x.md"
    url, payload = _FakeClient.last_post
    assert url.endswith("/seedling")
    assert payload["opener"] == "Idea." and payload["origin"] == "learn-hub"
    assert payload["links"] == ["A"]


def test_swallows_errors(monkeypatch):
    mod = _reload(monkeypatch, "http://host.docker.internal:8799")

    class _Boom(_FakeClient):
        async def post(self, url, json):
            raise RuntimeError("network down")

    monkeypatch.setattr(mod.httpx, "AsyncClient", _Boom)
    assert asyncio.run(mod.emit_seedling("Idea.")) is None
