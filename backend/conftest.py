"""Pytest config for the backend test suite.

The unit tests are pure (no DB) and run everywhere. Integration tests marked
``@pytest.mark.integration`` hit a real Postgres and are SKIPPED unless
``LEARN_PG_TESTS=1`` — so the default ``pytest -q`` stays DB-free (CI runs them in a
dedicated job with a Postgres service). See docs/testing.md.
"""

from __future__ import annotations

import os

import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "integration: real-Postgres round-trip; needs LEARN_PG_TESTS=1 and a reachable DB",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if os.environ.get("LEARN_PG_TESTS") == "1":
        return
    skip = pytest.mark.skip(reason="integration test — set LEARN_PG_TESTS=1 with a reachable Postgres")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)
