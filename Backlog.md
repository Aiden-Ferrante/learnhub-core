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

- **v0.19.0 Practice items and v0.20.0 Show your work — both cycles aborted 2026-08-26**,
  to be re-planned with more care. No versions cut. Both records are kept, renamed out of the
  version namespace, and carry retros; the two spikes are the part worth not re-running.
  v0.20.0's *code* shipped regardless — the grounding check, its CI test and the encoding
  repair are in `main`, and aborting the cycle withdraws the version, not the work.
- **Splitter findings D3–D6** (v0.18.0, 2026-08-26). Fenced code (D1) and setext headings
  (D2) were built because a real book exercised them — 11 of 12 books contain fenced code,
  and the splitter demonstrably turned a Python comment into a chapter. Nothing in the
  library exercised D3–D6, and writing splitter rules against imagined markdown is how the
  fenced-code bug got missed in the first place. Cut at the moment it was cut.
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

- **Two documents have no card, so they cannot be deleted from the Processing tab at all.**
  (v0.17.0.) `Axler-Measure-Integration` and `Durrett-Probability`. The tab lists
  `app_documents`, so a document with no card is unreachable from it — the orphan problem from
  the other direction, and not in v0.17.0's finding list. (The two `converting` zombies that
  were also in this state were deleted 2026-08-26 via the API.)
- **333 MB of orphaned files, from deletes that predate v0.17.0.** One ingest directory
  (3.5 MB, 2026-07-17) and four audiobook directories (121 MB, 178 MB, 26 MB, 5.7 MB), none
  with a source row. Nothing creates these any more — the delete path removes both trees now —
  so this is a one-off sweep, not a recurring leak. Worth a `scripts/` reaper that lists
  orphans and removes them on `--apply`, in the shape of the other two scripts.
- **A browser check that cannot fail is not a check.** (v0.17.0.) A card deleted from the
  Processing tab stays deleted whether or not the backend was called, because a card with no
  `learnDocId` is pruned client-side. Verifying it required arranging for a specific number to
  move. Applies to every future criterion with a browser half.
- **Question generation works; the prompt is the remaining work.** (Aborted v0.19.0.) Both
  spikes passed: retrieval questions ~75% usable, and problem authoring produces genuine
  work with worked solutions that check out by hand. Both failure modes are the same shape —
  "According to the text…" (23% of questions) and "as shown in step 3 of Table 2-1" on
  procedural sections — a reference to the book's furniture rather than its subject, and both
  prompt-forbiddable. The degeneration is a property of the SECTION, not the book.
- **The model never refused.** (Aborted v0.19.0.) It found something to work in every section
  it was given, including two narrative ones. Better than expected, but it means a genuinely
  contentless section might yet get an invented task, and nothing tests that.
- **Nobody has read a chapter of concepts against its source.** (Aborted v0.20.0.) The
  mechanical check proves the QUOTE is real — 1,463 of 1,463 trace. It says nothing about
  whether the *signal* the learner reads follows from that quote, and a real sentence with a
  wrong gloss passes every check in this repo. No script can close this one.
- **Four `signal` values still carry `\not`/`\nabla` encoding collisions.** (Aborted v0.20.0.)
  Unverifiable — `signal` is authored text, so the section markdown is not ground truth for
  it. They clear on re-extraction.
- **An honesty fix that stops the queue is worse than the dishonesty it replaced.**
  (v0.18.0.) Making `requeue_interrupted` raise instead of `pass` is right at the gateway,
  and it would have killed the worker on the first failed recovery because the call sits
  outside the loop — the queue silently draining nothing. Caught by running it, not reading
  it. When a fix converts silence into an exception, check what catches it.
- **`run_convert`'s failure paths are unexercised.** A fault-injection hook for the converter
  would make v0.18.0's criterion 2 checkable rather than argued from reading.
- **The ledger key includes `kind`, and `build`/`extract` are runner aliases but not key
  aliases.** Nothing is broken; the asymmetry cost twenty minutes of debugging a cancel that
  reported "no job" for a running job, and will again.
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
