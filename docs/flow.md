# Learn Hub — user flow

_How someone actually uses this, start to finish. One heading per step._

Written from the README's "Why", the frontend component atlas in the vault, and the
code where the two disagreed. Screen names come from the atlas, which takes them
from `frontend/src/surfaces/` — never invented.

## 1. Sign in

**They** — open `localhost:3001` and log in.
**It** — checks the credentials and puts them in their own tenant schema.
**Breaks when** — the account doesn't exist yet. There is no self-serve signup:
accounts are rows in `auth.users` (username, password hash, tenant `schema_name`)
inserted directly against Postgres by hand. For anyone but the author this is where
the flow stops, and a provisioning command is a known gap.

## 2. Drop in a PDF

**They** — go to **Upload** (`/upload`) and drop a textbook in.
**It** — takes the file, makes it a document, and hands it to processing.
**Breaks when** — the PDF is a scan rather than text, or its table of contents is
malformed. Everything downstream is built on the converted outline, so a bad
conversion is not recoverable later in the flow — it has to be re-done here.

## 3. Watch it become a course

**They** — go to **Process** (`/process`) and watch the build, chapter by chapter.
**It** — converts the book into parts → chapters → sections, then runs a local model
over a chapter on demand to pull out its concepts. The **machine strip** shows model
residency and a self-calibrating ETA; the **concept receipt** shows what was actually
extracted, and lets bad concepts be culled in place before they reach study.
**Breaks when** — you expect the whole book at once. Extraction is per-chapter and
deliberate: a whole-book pass is hours, and studying chapter 2 shouldn't wait on
chapter 40. Also `TASK-18`: Process counts build units while the course page renders
the syllabus tree, and they disagree — FoSA shows 54 against 28, because a
"Discussion Questions" node exploded into 27 phantom chapters during conversion. The
same book looks like two different books on two screens.

## 4. Read a chapter

**They** — open the course (`/courses/[id]`), pick a chapter from the strip or the
syllabus tree, and read it in the **Chapter Reader** — guided reading, the Path
strip, Tutor, Listen. Or read it continuously in the **Book Reader** (`/read`).
**It** — renders the converted text with the concept layer available alongside.
**Breaks when** — the chapter was never built. A section with no extraction is not
broken, it is unbuilt, and those read differently: unbuilt means go to Process,
stale means the material changed after its concepts were made.

## 5. Practice what the chapter held

**They** — open the study drawer inside the Chapter Reader and do the two graded
activities: **skeleton recall** — reconstruct the chapter's shape — and **concept
recall** — do you know the ideas inside it.
**It** — grades each item and schedules it with FSRS.
**Breaks when** — you read without grading anything. Mastery is computed from
concepts and reviews only, and the docstring on `compute_mastery` says so on
purpose: retention already encodes time and outcomes through FSRS. So reading moves
the page and the clock, and moves nothing on the chart. **Studying is not what the
system counts. Grading is.**

## 6. Come back when it is due

**They** — open **Study** (`/study`) and work the queue.
**It** — pools every course: what is due now, a 60-day review calendar, a year-long
activity heatmap, and session history clustered from gaps rather than stored.
**Breaks when** — nothing is due, and it is not obvious whether that means caught up
or never started. An empty queue and an empty database look the same from here.

## Where it ends

They walk away with a book that reviews itself — the system decides what is next
rather than asking. It worked if retrievability holds above ~0.9 on a chapter thirty
days after one pass, which is the waypoint on Quality in the subproblem map.

The honest state of that claim is `assumed`. It is measurable from FSRS data
today — the blocker was never the measurement, it was having enough real study
behind it to measure.
