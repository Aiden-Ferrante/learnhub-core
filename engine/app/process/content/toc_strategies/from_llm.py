"""derive/from-llm — LLM-proposed outline (priority 3; STUB).

Registered so the decision log shows it declining; build only if the logs show
real books defeating from-headings and from-contents-pages.

When built, note the open contradiction to resolve first: the addendum says
"uses the existing gateways/llm", but the strategy contract forbids importing
gateways — and conversion is deliberately a non-LLM job. The likely resolution
is a queued repair job kind rather than a synchronous strategy here; either way,
the LLM proposes and the same sanity gates dispose.
"""

from __future__ import annotations

from app.process.content.toc_strategies.base import DeriveOutcome, TocDeriveContext


def derive(ctx: TocDeriveContext) -> DeriveOutcome:
    return "not implemented"
