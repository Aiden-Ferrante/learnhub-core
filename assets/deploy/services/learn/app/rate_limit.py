"""Simple per-IP sliding-window rate limit for chat."""

from __future__ import annotations

import time
from threading import Lock

_lock = Lock()
_hits: dict[str, list[float]] = {}


def check_rate_limit(client_ip: str, max_per_minute: int = 30) -> bool:
    """Return True if allowed, False if rate limited."""
    now = time.monotonic()
    cutoff = now - 60.0
    with _lock:
        # Sweep fully-expired IPs so the table doesn't grow without bound for
        # clients that hit once and never return (cheap: low cardinality here).
        for ip in [ip for ip, ts in _hits.items() if not ts or ts[-1] < cutoff]:
            del _hits[ip]

        arr = _hits.setdefault(client_ip, [])
        while arr and arr[0] < cutoff:
            arr.pop(0)
        if len(arr) >= max_per_minute:
            return False
        arr.append(now)
    return True
