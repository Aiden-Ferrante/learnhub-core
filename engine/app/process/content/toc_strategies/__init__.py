"""TOC derive strategies — the fallbacks when a PDF has no usable bookmarks.

Only the TOC controller may call these. Contract in base.py: every strategy is
pure, takes a TocDeriveContext, and returns raw-bookmark-shaped entries, a
decline reason (str), or None. The controller iterates STRATEGIES in order and
takes the first outline. Adding a strategy = one new file + one entry here.
"""

from app.process.content.toc_strategies.base import DeriveOutcome, TocDeriveContext
from app.process.content.toc_strategies import (
    from_contents_pages,
    from_headings,
    from_llm,
    from_markdown_headings,
)

# Ordered (name, fn) — priority order; names appear in decision logs as "derive/<name>".
# Read the numbering before inferring anything: a document that numbers its own headings
# has stated its structure, and every strategy below this one is a recovery pass.
STRATEGIES = (
    ("from-numbered-headings", from_markdown_headings.derive),
    ("from-headings", from_headings.derive),
    ("from-contents-pages", from_contents_pages.derive),
    ("from-llm", from_llm.derive),
)

__all__ = ["DeriveOutcome", "STRATEGIES", "TocDeriveContext"]
