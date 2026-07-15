"""Overview — cross-domain read models.

Owns: the course Today plan (plan) and the chapter x artifact readiness/coverage
grids over the jobs ledger (coverage). Sits above the domains so it may read all
of them; nothing imports overview except api. Depends on: content, extraction,
study, media, platform.
"""

from app.overview.coverage import chapters_coverage, chapters_readiness
from app.overview.plan import build_plan

__all__ = [
    "build_plan",
    "chapters_coverage",
    "chapters_readiness",
]
