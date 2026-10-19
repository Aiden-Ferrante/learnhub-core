#!/usr/bin/env python3
"""claude-bridge: lets the learn container use claude:* models (v0.23.0).

The Claude Code login lives on the host; the backend runs in Docker. This serves ONE
endpoint, POST /structured {messages, schema, model, timeout} -> {result, error}, by
calling the same llm._claude_structured the host scripts use. It binds the compose
network's gateway (only containers on that bridge reach it, never the LAN or tailnet)
and refuses any request without the shared token. Approved by the human 2026-10-19.

    CLAUDE_BRIDGE_TOKEN=... python scripts/claude_bridge.py   # 172.20.0.1:8897

Env: CLAUDE_BRIDGE_HOST (default 172.20.0.1), CLAUDE_BRIDGE_PORT (8897),
CLAUDE_BRIDGE_TOKEN (required), LEARN_CLAUDE_USAGE_LOG (optional token log).
"""
from __future__ import annotations

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from app.gateways.llm import _claude_structured  # noqa: E402

TOKEN = os.environ.get("CLAUDE_BRIDGE_TOKEN", "")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "checks": {}, "freshness": {}})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/structured":
            return self._send(404, {"error": "not found"})
        if not hmac.compare_digest(self.headers.get("x-bridge-token", ""), TOKEN):
            return self._send(403, {"error": "bad token"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            result, error = _claude_structured(
                req["messages"], req["schema"], str(req["model"]), float(req.get("timeout", 300))
            )
        except Exception as e:  # noqa: BLE001
            result, error = None, str(e)
        self._send(200, {"result": result, "error": error})

    def log_message(self, fmt, *args) -> None:  # one line per call, no bodies
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")


def main() -> None:
    if not TOKEN:
        sys.exit("CLAUDE_BRIDGE_TOKEN is required")
    host = os.environ.get("CLAUDE_BRIDGE_HOST", "172.20.0.1")
    port = int(os.environ.get("CLAUDE_BRIDGE_PORT", "8897"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
