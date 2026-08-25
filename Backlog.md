# Backlog

The queue Development Protocol 1.0 assumes and this repo has never had. Three
things land here and nothing else:

- **Pruned children** — scope cut out of a cycle, written down at the moment it
  was cut. A pruned list assembled afterwards is a description of what you
  happened not to do.
- **ADR seeds** — a decision that wanted an ADR and didn't get one yet.
- **Retro items** — "what carries forward" from a closed cycle.

An item here is not scheduled. The next light plan pulls from this file; it does
not add to it mid-build.

## Pruned

- **Real mid-flight convert cancel** (v0.18.0, 2026-08-25). Docling is a single opaque
  call with no page loop to hook, so interrupting a conversion already inside the engine
  means hosting it in a killable subprocess. Cut as a design change, not a bug fix. What
  shipped instead brackets the engine: a job cancelled while queued or before the engine
  starts stops immediately, and one cancelled mid-conversion no longer persists a document
  nobody wants.
- **Incremental concept writes** (v0.18.0, 2026-08-25). They change the dedup's
  first-occurrence semantics, which is a product decision rather than a repair.

## ADR seeds

- **Should a derived outline synthesise chapters the document did not number?**
  (2026-08-25.) `from-numbered-headings` reads the numbering the author wrote and refuses to
  invent levels — correct as a contract, but a book whose chapters read "Chapter 2 The
  Nature of Complexity" carries no `number_key` on them, so it gets an outline of 125
  sections under *nothing*: no `toc:1`, no `toc:2`. Nothing errors; the syllabus simply has
  no top level, and scope resolution has no chapter to resolve. Recorded as a strict xfail
  in `test_toc_controller.py` so it announces itself. Two ways out — teach the splitter to
  read a `Chapter N` prefix as numbering, or let the strategy synthesise parents — and they
  are different contracts, which is what makes this an ADR rather than a fix.
- **Should a practice grade feed a progress signal of its own?** (2026-08-22, from
  `docs/practice-items-spec.md`.) The three-question model is coverage / retention / state;
  production fluency would be a fourth. See the Competency chart node.

## Carries forward

- **A probe that runs beside the service can only measure a cold path.** (v0.16.0.) Every
  measurement bug in that cycle had one shape — a one-time cost inside a timed region — and
  the worst one invalidated a *fix* rather than a number: `docker exec python -c` spawns a
  separate interpreter that never sees the service's warmed pipeline, so a working warm-up
  measured as broken.
- **The documented test command disabled its own gate.** (2026-08-25.) It never mounted
  `backend/conftest.py`, which is not in the image, so the `integration` marker went
  unregistered and the eight Postgres tests errored instead of skipping — ~240s of noise
  that read as environment trouble. The arc's own thesis, pointed at its own tooling. Both
  commands are now spelled out in ARCHITECTURE.md; the run is 0.5s.
- **A behaviour lock can pin a defect.** (2026-08-25.) `test_behavior_lock[pagematched]`
  froze pre-controller output containing 28 duplicate section keys — exactly what `6a54ae6`
  later fixed — so the lock failed *because* the bug was gone. Regenerating a frozen
  expectation is only honest when you can show the divergence is precisely the intended
  change, and when a property test replaces what the blob was implicitly guarding.
- **Reading position is keyed to the course card**, so it is shared across versions; a shelf
  card still shows the book's original section count rather than the active version's.
  Named in v0.15.0's "Not verified" and still true.
- **`app_documents` cards resolve their own `learn_doc_id`**, so setting a version as main
  does not yet change what a shelf card opens. (ARCHITECTURE.md, book/course seam.)
