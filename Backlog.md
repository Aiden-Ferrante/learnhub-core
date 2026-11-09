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

- **Sandboxed widget host** (v0.24.0, cut at plan time 2026-11-01, agent's default, human to
  confirm). Native React covers the picked scope; no bespoke per-course tool needs it yet.
- **Hardening the pack sandbox** (v0.24.0). AST gate plus limits contains our own model's code.
  Real isolation (a separate user or container) is the `code` kind's job when that cycle comes.
- **Formula anatomy cards, geometry sandboxes, predicted-vs-actual** (brainstorm 2026-11-01). Not
  in the agreed scope.

- **MCQ flaw rules + distractor metrics** (v0.23.0, deferred at plan time 2026-10-16 —
  human decision). Deterministic item-writing-flaw rules for `mcq` items (longest option
  correct, "all of the above", stem cue repeated in the key — Tarrant et al.'s 19, as
  operationalised by SAQUET, arXiv 2405.20529) and D-GEN's distractor metrics (ACL 2025
  Findings). Rides with the cycle that builds the `mcq` kind; nothing to check until then.
- **DeepSeek-V4-Flash in the bake-off** (v0.23.0, cut at plan time). The strongest open
  weight that nominally fits the Spark, but its 3-bit build is 129 GB against ~120 GB, and
  the 2–3-bit builds (97–103 GB) need the QEMU VM and most of the fleet stopped. Worth one
  run if a bake-off winner disappoints.

- **v0.23.0 Set the paper — aborted 2026-10-16** (human decision, to open the
  authoring-quality cycle). Its code is in `main` and observed on prod; what it owed:
  - **Rung 3 — sit one self-set paper on :3001** and log every miss. Still the only
    evidence a human has ever used the exam.
  - **M1 — per-section fluency drops chapter-level items.** `mastery.py`'s rollup sums
    `descendant_leaves` only, so an item or concept on a non-leaf section is invisible to
    every per-section number (chapter 2: 22 counted of 29, attempted 0 of 2).
  - **M2 — fluency reads 1.0 after a 50% paper.** FSRS retrievability is ~1 right after
    any review, whatever the grade; honest about the engine, useless about the sitting.
  - **Verify-rung debris on prod**: open sittings `e8419b3a`, `e985e027`, `acb30ef1` and
    finished `710bf83c` — the human decides whether they go.

- **Fluency-before snapshot on a sitting** (v0.23.0, cut at plan time 2026-09-08). Freeze
  each picked scope's fluency into the sitting's `config` so results can show predicted
  beside actual per section — the whole "the app told me before the exam did" waypoint in
  one column. Cut so the cycle stayed the pick; still the cheapest way to make the
  Competency waypoint observable.

- **v0.19.0 Practice items and v0.20.0 Show your work — both cycles aborted 2026-08-26**,
  to be re-planned with more care. No versions cut. Both records are kept, renamed out of the
  version namespace, and carry retros; the two spikes are the part worth not re-running.
  v0.20.0's *code* shipped regardless — the grounding check, its CI test and the encoding
  repair are in `main`, and aborting the cycle withdraws the version, not the work.
  **Re-planned 2026-08-28** as a four-phase arc with widened scope (games, exams, code
  runner — user decision): [[v0.19.0 — Practice items, the pool]] is built; v0.19.1
  games → v0.19.2 exams → v0.19.3 sandbox runner are next. The spec carries the
  amendments.
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

- **Fleet metadata in a public repo.** (v0.26.0.) The 11/05 public cleanup removed PROJECT.yaml
  and the agent docs from git. They now live on disk, gitignored. Shipyard and
  `fleet/render_agent_docs.py` still write and read them. Decide whether that is the contract,
  or whether fleet metadata moves into the fleet repo.

- **Versioned-course due counts.** (v0.25.0.) Concept review rows sit under the source book's id,
  so a re-cut version's dues count under the source course.
- **On-accent ink.** (v0.25.0.) `--primary-foreground` is zinc-950 and `--fleet-on-accent` is zinc-50.
  Alias one onto the other or document the split.

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
  production fluency would be a fourth. See the Competency chart node. **Resolved in
  v0.19.0**: yes, as its own number — `summarize_fluency` over `kind IN ('problem','code')`,
  never averaged into retention, unknown ≠ zero, no solid/shaky adjectives.

## Carries forward

- **The converter loses quiz code.** (v0.26.0.) Of 130 unanswered PE book problems, 46 have no
  code in the stem and 20 have it flattened with line numbers ("1 2 3 print(...)"), so they stay
  self-marked. The fix is in conversion (or reconversion), not in packs.
- **Scripts that call the author must use the deployed model.** (v0.26.0.) The host has no
  `LEARN_PRACTICE_MODEL`, so set it as in compose, or run in the image.

- **Visual pass, next cycle (human, 2026-11-04).** "Make the visuals more pleasing." Chosen
  feel: *calm reading room*: warmer dark, softer contrast, more breathing room, serif body
  for reading, sans labels. Dark only. Screens: Library + course home, Reading, Exam packs,
  Review + recall (all four). Opens after v0.25.1 is tagged.

- **ESLint.** (v0.25.0.) There is no config or package, so `next lint` stops at a setup prompt.
- **Deploy split.** (v0.25.1.) The agent may build images but not `up -d` on prod. Hand the
  human that one command, with `!`.
- **Unused hook.** (v0.25.0.) `kit/hooks/use-polling.ts` has no importers.
- **Prod browser verification.** (v0.25.0.) Decide on a sanctioned way for agents to sign in, or
  keep using the human's Chrome.

- **The human reads generated pack questions.** (v0.24.0, 2026-11-01.) Shipped without it; the
  repo's criterion for generated content is still owed.
- **Reconvert Python Essentials 2.** (v0.24.0.) Its upload is in `Error` with no content.
- **Agent docs are stale across the fleet and feedwall's source is behind its repo.** (v0.24.0.)
  Fix `fleet/agents` before rendering, or feedwall loses its current credentials note.

- **Per-section mastery ignores items and concepts on non-leaf sections.** (v0.23.0 verify,
  2026-09-09.) `mastery.py` rolls a section up from `descendant_leaves` only, so anything
  attached to a chapter or sub-chapter node counts overall but in no section: prod chapter 2
  shows 22 problem items and 0 attempted where 29 exist and 2 were graded. Latent since
  v0.19.0; surfaced by a book whose chapters carry their own prose. One-line fix, but it is
  a mastery-axis change and belongs to its own light cycle with a planted violation.

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
