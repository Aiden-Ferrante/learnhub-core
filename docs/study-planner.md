<!-- Shipped 2026-07-16. The "working session tracker" feature: decisions + contracts. -->

# Study planner: sessions, decay, and the review calendar

Everything you study fades after the session; each review solidifies it. This doc records how
that model is wired and the decisions behind it (all four were explicit user choices).

## 1. Scheduler: FSRS (was SM-2)

`app/study/srs.py` wraps **py-fsrs** behind the same pure state-dict contract
(`new_state / schedule / is_due`); grades 1-4 map 1:1 to FSRS Again/Hard/Good/Easy. Each item
carries `(stability, difficulty)` on its `concept_reviews` row; `retrievability(state, now)`
is the modelled "fraction still remembered". Configuration decisions:

- **No learning steps** — the first Good graduates straight to a multi-day interval, so new
  cards don't linger due inside the session (the old scheduler's feel).
- **"Again" relearns in ~10 min** (relearning step) — unchanged behavior.
- **Fuzzing off** — deterministic dues, testable.
- **Legacy rows migrate lazily**: pre-swap rows have `interval/ease` but no stability; the
  first grade seeds FSRS memory from them (stability ≈ interval, difficulty from ease).
  No batch rewrite; `ease`/`interval` columns stay for display + mastery's decay tau.

## 2. Working sessions: derived, never stored

`app/study/sessions.py` gap-clusters the append-only `study_events` floor (25-min gaps) into
typed sessions — duration, per-kind counts, dominant kind (graded work outweighs passive
read/listen pings), courses/scopes touched, graded accuracy. Sessions are a **view**: nothing
is written, all history sessionizes retroactively, and the definition can evolve without a
migration. Served at `GET /api/study/sessions`.

## 3. What decays: concepts + structure + figures + **chapters**

Concepts, skeleton (structure-recall), and figure items already lived in `concept_reviews`.
New: **chapter resurface items** (`chap-…`, `item_type='chapter'`) — opening a chapter's
reading surface seeds one via `ensure_chapter_item` with an implicit first-exposure Good
(due back in ~2 days). Reveal snapshot = the chapter walk's skeleton, else top concepts.
Semantics: seeding is idempotent; **re-reading never touches the row** (reading isn't
recall — only grading moves the schedule). Cards serve through the same chapter-scoped queue
("resurface" badge) and grades log `resurface` study events.

## 4. The aggregator: /study

`GET /api/review-calendar` buckets every scheduled item per-day over a horizon, per course and
per item type, plus the overdue pile — the whole library pooled. (`/api/study-debt` remains the
compact rollup for the nav badge + vault briefing.) The `/study` page renders it as a
Monday-aligned 60-day grid with a per-day breakdown, the due-now pile, and the session history.
The nav's due badge lives on Study.

## Deferred / next

- Feed the calendar into the 06:45 vault briefing (vaultwriter) and/or an `.ics` feed —
  both were considered and parked.
- FSRS parameter optimization from own review logs (needs the separate fsrs-optimizer
  torch package; revisit when there's enough history).
- Per-session retention scores on the /study page (retrievability is already exposed by srs).
