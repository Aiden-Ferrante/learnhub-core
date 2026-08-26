# Goal Prompt — Close the board

Super-cycle · learn-hub `v0.17.0 → v0.20.0`
Drafted 2026-08-26. Fossilised on Build gate — corrections go to ADRs, never back-edits.

> **Amendment, 2026-08-26.** The arc was cut short by decision, not by failure. **v0.18.0
> cut.** **v0.19.0 and v0.20.0 were aborted** to be re-planned with more care; their records
> are renamed out of the version namespace and carry retros. v0.17.0 remains open. The
> measuring stick below is left as drafted rather than rewritten — a goal prompt that edits
> itself to match the outcome measures nothing.

Addresses **Make learning more efficient** (`0d6a42ad415a`) and, through its cycles,
**Competency** (`0ee146aab681`) and **Grounding** (`c7bbd44951fe`).

---

## 0. The protocol, inlined

*Development Protocol 1.0 lived in the vault's `Projects/` tree, archived 2026-08-14. The
mechanics this arc uses are restated here so the prompt is self-contained.*

```
   PLAN ────────► BUILD ────────► TEST ────────► REVIEW
   human          agent           both           human
   leads          leads                          leads
     ▲                                              │
     └────── retro → Backlog.md → next Plan ◄───────┘
```

A cycle is **atomic**: it passes all four phases and cuts a version, or it cuts nothing.
There is no version for "got through build and testing". If the re-plan valve fires
mid-cycle, the cycle aborts — learnings go to a retro, no version is cut.

The version bump is the transaction commit. `CHANGELOG.md` is the write-ahead log; git tags
are the only durable record of finished work. **A record with no tag is an open cycle**, and
that is the fact this arc exists to act on.

---

## 1. Problem

**Four cycles are open at once, and not one of them is stuck on code that is hard to write.**

| Cycle | State | What is actually blocking it |
|---|---|---|
| v0.17.0 Delete means delete | every finding built, 9 tests, criterion 6 verified live | a **migration nobody has run**, and two criteria with a browser half |
| v0.18.0 Jobs that admit failure | ~10% built | ~10 findings of real code, then **cancelling a real conversion** |
| v0.19.0 Practice items | designed in full, nothing built | a **spike nobody has run** — whose purpose is to possibly kill the plan |
| v0.20.0 Show your work | 4 of 5 criteria pass | **reading one chapter** against its source |

Three of the four are blocked on *doing something with the real artifact*, and the fourth
(v0.18.0) ends in the same place. That is not four unrelated stalls; it is one habit. Work
gets built and then not exercised, because building is the part that feels like progress and
exercising is the part that can only tell you bad news.

The repo has been closing cycles slower than it opens them. v0.15.0 and v0.16.0 both sat
built-but-untagged for weeks, and both closed in a single sitting once someone actually ran
the last check — v0.15.0's had been deferred for a reason that had expired, and nobody had
looked. That is the whole shape of this arc: **the expensive part is already paid for.**

**Two of these need a migration, and migrations are the one thing the agent cannot apply.**
`ALTER` is blocked by a `PreToolUse` guard, correctly. v0.17.0's `origin` CHECK is written
and unapplied; v0.18.0's C5 needs an `attempts` column that does not exist at all. Plan for a
human hand on those two, or the cycles stall again for a reason that has nothing to do with
the work.

## 2. Vision + measuring stick

**Vision.** The board is empty. Every cycle on disk carries a tag, every claim in a record
was checked by running something, and the next plan starts from zero open work rather than
from four half-finished arcs.

**Measuring stick.** One number rules the arc:

| Measure | Now | Target |
|---|---|---|
| **Cycle records with no tag** | **4** | **0** |

Underneath it, per cycle, measured 2026-08-26:

| Measure | Now | Target | Cycle |
|---|---|---|---|
| `origin` CHECK present in the dev database | no | yes | v0.17.0 |
| Bare `except Exception: pass` in `gateways/ledger.py` | 5 | 0 | v0.18.0 |
| Job runners that can never reach a cancel check | 1 (`skeleton`) | 0 | v0.18.0 |
| `chapter_builds.attempts` column | absent | present + honoured | v0.18.0 |
| Splitter sites handling fenced code / setext headings | 0 | covered | v0.18.0 |
| Rows in `ext_guides` | 0 | read and judged | v0.19.0 |
| `ext_practice` table | absent | in use | v0.19.0 |
| `Grounding` sounding | `proxy` | `observed` | v0.20.0 |

Plus three binaries, each of which can only be answered by a person at the running app:

- Deleting a book from the Processing tab removes it, and an orphan card disappears.
- Cancelling a long conversion stops it, and cancel-then-restart leaves it dead.
- The questions a chapter generates are worth sitting down to answer.

## 3. Appetite

**Four sub-cycles, closed in the order below, and the arc is done when the board is empty.**

The order is not arbitrary and is not "smallest first". v0.17.0 and v0.18.0 are the tail of
the honesty arc and they gate v0.19.0's step 4, which adds a writer to the measurement layer
they are repairing. v0.20.0 is independent and can close at any point — it needs a person for
twenty minutes, not a build.

If any cycle overruns, it sheds scope rather than time, and the shed scope goes to
`Backlog.md` as a pruned child at the moment it is cut — not assembled afterwards.

## 4. The arc

### v0.17.0 — Delete means delete *(open, nearly closed)*

Everything is built and tested; see the record. To close:

- **Apply `deploy/postgres/migrations/2026-08-25-origin-check.sql`.** Needs a human — the
  agent's `ALTER` is blocked. This is criterion 4 and nothing else stands in its way.
- **Drive the two browser halves.** The Processing tab's delete, and an orphan card
  disappearing from the shelf. Both are verified as far as the API and no further, because
  `:3001` sits behind a login wall. Criteria 1 and 3.

**Do not re-open the finding list.** B1–B8 and F4/F5 are done and the tests cover them; the
temptation here is to keep improving delete instead of tagging it.

### v0.18.0 — Jobs that admit failure *(open, ~10% built)*

The only cycle in this arc that still needs real code. Landed: the C6 cheap half, and a
restart that stops honouring a cancelled job. Remaining:

- **C1** terminal ledger writes stop being best-effort — 5 bare `except: pass`, including
  the `running` claim whose loss re-hands the row to the next poll as a silent double-run.
- **C2** every exit from `run_convert` marks the document.
- **C3** an extraction where every section failed reports failure.
- **C4** skeleton stops caching empty essences — and note `skeleton.py` calls neither
  `ctx.progress` nor `check_cancel`, so it is also the one runner cancel can never reach.
- **C5** attempt cap + `not_before` backoff. **`attempts` does not exist as a column** — this
  needs a migration, so it needs a human hand, same as v0.17.0's.
- **D1–D6** the splitter: fenced code blocks and setext headings have **zero** handling
  today. D7 already landed in `6a54ae6`.

Then criterion 6: cancel a real conversion in the running app, images rebuilt.

**Non-goals stand.** No mid-flight convert cancel (docling in a killable subprocess is a
design change). No incremental concept writes.

### v0.19.0 — Practice items *(open, nothing built)*

**Step 1 is a spike and it comes first, alone.** Run the existing `guides` job on one real
converted chapter and *read what it produces*. `ext_guides` holds 0 rows, so nobody has ever
seen this model's question quality, and the entire design rests on it being good enough to
build a pool around. If it is not, **the prompt is the work and the schema was never the
bottleneck** — re-plan here rather than proceeding. This costs one enqueue and it is allowed
to kill the plan.

Only if the spike passes: `ext_practice` + the `practice` job kind → the Practice tab →
the `_TYPED` entry and its own session → production fluency.

**Step 4 waits for v0.17.0 and v0.18.0 to tag.** It adds a writer to the measurement layer
they are repairing, and a half-fixed measurement layer plus a new writer makes both
untestable. Steps 1–3 touch `ext_practice` and the course editor only and are safe to build
in parallel with them.

### v0.20.0 — Show your work *(open, 4 of 5)*

One criterion: **read one chapter of concepts against its source.** Not the check — the
check runs and passes, 1,463 of 1,463 traced. This is the thing the check is a proxy for, and
it is the only criterion in the whole arc that a machine cannot close on its own.

What it is looking for is not whether the quote is real — that is settled. It is whether the
**signal** follows from the quote. A real sentence with a wrong gloss attached passes every
mechanical check in the repo, and nobody has ever looked.

Closing it moves `Grounding` from `proxy` to `observed` — the first `observed` node in the
chart.

## 5. Exit criteria for the arc

1. **`git tag` lists v0.17.0, v0.18.0, v0.19.0 and v0.20.0.** Or fewer, with an abort
   recorded in a retro for each one that did not cut — an aborted cycle is a legitimate
   outcome and an untagged open record is not.
2. Every measure in §2 reads its target, or the gap is written down with a reason.
3. `CHANGELOG.md` has an entry per tag, written at the time rather than reconstructed.
4. No record claims a criterion passed that was not run. The v0.17.0 record already
   distinguishes a HALF-met criterion from a passed one; keep that standard.
5. `Backlog.md` carries the pruned children and the retro items, added when cut.

## 6. How this gets verified

Per the standing rule, **render the real artifact.** Every measure in §2 has a plausible
wrong value available to it, so a green suite proves nothing on its own:

- The suite runs both tiers — mount `backend/conftest.py` or the integration tests silently
  error instead of running (ARCHITECTURE.md carries both commands).
- Every binary in §2 is exercised against a real book in the running app with the images
  rebuilt, not against a fixture.
- `scripts/check_grounding.py` runs against the real library, not CI's empty one.
- A criterion that was not run is recorded as not run.

## 7. The decision this prompt does not take

**Whether v0.19.0 survives its own spike.** The plan is written on the assumption that
locally-generated questions are good enough to build a pool around, and that assumption has
never been tested. If step 1 says no, the honest outcome is to abort v0.19.0, record the
retro, and let Competency stay `assumed` until there is a prompt worth building on. Deciding
that in advance — in either direction — would make the spike ceremonial.
