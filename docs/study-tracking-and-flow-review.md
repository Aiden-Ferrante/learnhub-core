# Study Tracking & Learning Flow — Research-Backed Review

**Scope:** the Learn service's mastery/tracking model (`mastery.py`, `srs.py`, `study_events`, `concept_reviews`, `chapter_progress`) + the chapter learning flow (orient → learn → read → quizzes → exam → lock-in, incl. the new unified `chapter-walk`).
**Question 1:** Am I tracking the right things?
**Question 2:** Does the flow follow research-backed guidelines?
**Method:** read the core model directly + two breadth audits (tracking, flow) + current research (FSRS, knowledge tracing, retrieval-practice/pretesting). Claims tagged **[verified]** (confirmed in code) vs **[review]** (audit-surfaced, spot-check before acting). I down-rated a couple of the audits' stronger opinions where the research is genuinely mixed.

---

## TL;DR

Your **foundation is genuinely strong and principled** — an append-only event floor with view-time recomputation, Beta-Binomial-smoothed accuracy, concept-level mastery with Knowledge-Space-Theory gating, SM-2 spacing, sibling-distractor + LLM-critic MCQs, and a retrieval-first chapter walk. You're tracking the *right primary signal* (graded recall correctness).

The gaps are about **using signals you already have** and **closing the loop**, not adding gamified noise (consistent with your "recall-first rigor, no XP/streaks" stance):

1. **Your mastery "forgetting" ignores your own spacing schedule.** Decay is a global τ=14d, but you already compute per-concept *stability* (SM-2 interval/ease). That's the #1 "tracking the right thing" fix. **[verified]**
2. **Your strongest retrieval signal — free recall — isn't tracked at all.** The skeleton/frame recall (now the heart of the walk) records no event, only a stage-done flag. **[verified]**
3. **Feedback is source-orphaned.** You *have* each concept's `signal` + `source` sentence but don't show them when a learner answers wrong. Highest-leverage flow fix. **[verified the data exists]**
4. **Spaced review is siloed** from the daily path; **concept learning is posttest-only** (a guess-before-reveal would add the research-backed *pretesting* effect). **[review]**

Two corrections to the audits: the "sequence is pedagogically inverted, reorder read/quiz" claim is **overstated** — that ordering is a defensible advance-organizer design; and SR review *does* feed mastery (it's not fully siloed at the data layer).

---

## PART 1 — Are you tracking the right things?

### What you track today (the map) [verified]
- **`study_events`** (append-only): `{section_key, concept_key, triple_id, correct, ts, doc, stem, expected}`. Written by: concept-quiz answer, the per-leaf quick-checks, each exam question, and **review grades** (`correct = grade≥3`). *Not* written by: skeleton/free-recall, reading, orient, or the legacy whole-doc quiz/grade.
- **Mastery** (recomputed at read time): per leaf section = **coverage × accuracy × decay**; concept mastery = **accuracy × decay** (coverage=1 once seen). Accuracy = Beta(α=1,β=1) posterior; decay = `exp(−days_since_last/τ)`, τ=14d. Internal nodes = triple/concept-count-weighted rollup.
- **`concept_reviews`** (SM-2 state): ease, interval, reps, lapses, due — drives the review queue.
- **`chapter_progress`**: per-stage done flags (skeleton self-grade, exam score/pass).
- **Displayed:** mastery ring + Overall %, Studied / Need-review / Sections tiles, weakest-3, recent mistakes, concept mastery dots + gate, activity heatmap (raw event count/day), due-count.

**This is good architecture.** The event floor + view-time recompute is exactly right (decay is time-dependent), Beta-Binomial avoids the "1/1 = 100%" trap, and concept-level tracking with prerequisite gating is ahead of most tools.

### The gaps — in priority order

**1. Mastery decay ignores the spacing schedule you already compute. [verified] — highest leverage**
`mastery.py:171` decays every concept at a global τ=14d. But SM-2 already estimates *how fast this particular concept fades* (its `interval`/`ease`). Modern SR theory (FSRS) factors memory into **Difficulty, Stability, Retrievability** — and *retrievability* (your "decay") should be a function of *stability* (your SM-2 interval), not a constant. Result today: a concept you graded "Easy" (SM-2 schedules it 30+ days out) still reads as ~40% faded at 2 weeks, and the dashboard nags you to review things you actually know; conversely a fragile concept looks fine. **Fix:** compute decay as `exp(−days_since_last / (k · interval))` (retrievability from stability) instead of a fixed τ. You don't need full FSRS — just feed the SM-2 interval you already store into the decay. ([FSRS vs SM-2](https://www.diane.app/en/guides/fsrs-vs-sm2), [Anki FSRS](https://faqs.ankiweb.net/what-spaced-repetition-algorithm))

**2. Free recall is untracked. [verified]**
The skeleton/frame recall is your *best* signal — effortful free generation, the thing retrieval-practice research prizes most — and the new walk is built on it. Yet `gradeSkeleton` writes only a `chapter_progress` done-flag; no `study_event`, no mastery movement, and the typed recall lives only in localStorage. You're measuring mastery almost entirely from *recognition* (MCQ) while throwing away your *generation* data. **Fix (lightweight):** record the self-grade as an event (even coarse: nailed/most → correct), attributed to the section(s) recalled, so generation feeds mastery too.

**3. "Hard" review grade contradicts itself across the two systems. [verified]**
A review grade of 2 ("Hard") → `correct=False` for mastery accuracy, but SM-2 treats it as a *pass* (interval grows). So one action says "you got it wrong" to the dashboard and "you got it right, see you in N days" to the scheduler. **Fix:** decide what "Hard" means and make both agree (most tools treat Hard as a low-confidence pass → `correct=True` with reduced weight, or track grade rather than a boolean).

**4. No calibration, confidence, or latency. [review]**
You track *whether* an answer was correct, not *how sure* the learner was or *how long* they took — both are strong knowledge-tracing signals and the basis of metacognitive calibration (the single most under-trained study skill). This is rigor, not gamification, so it fits your stance. **Optional fix:** a 1-tap confidence before reveal; store response latency on answers. Surface "you're 80% confident but 60% right → overconfident." ([knowledge tracing / mastery measurement](https://arxiv.org/html/2502.19915v1), [learning analytics overview](https://en.wikipedia.org/wiki/Learning_analytics))

**5. Smaller items [verified unless noted]:**
- **Heatmap is unweighted** — a 12-question exam = 12 cells, a thoughtful 20-min read = 0. Consider counting *distinct concepts retrieved* or *minutes*, not raw event rows.
- **Coverage semantics differ** between concept docs (1 concept = full coverage once seen) and legacy triple docs (partial). Fine, but the same "coverage" word means different things.
- **Reading/orient produce no signal** — fine *if intentional*, but "Studied" only ever reflects quizzing, so a chapter you read carefully but didn't quiz reads as 0% studied.
- **Whole-doc quiz/grade** legacy path records nothing **[review]** — dead if unused.

---

## PART 2 — Does the flow follow research-backed guidelines?

Scorecard against the core evidence base (✅ strong · ◐ partial · ⚠️ gap):

| Principle | State | Notes |
|---|---|---|
| Retrieval practice / testing effect | ✅ | Skeleton free-recall + reveal gate; quick-checks right after encoding; MCQs throughout. |
| Advance organizer | ✅ | Orient (objectives + watch-fors) before diving in; the walk frames the whole chapter first. |
| MCQ construction | ✅ | Sibling distractors (same section/kind), LLM critic strips telegraphing/weak options, 3 cognitive types (apply/distinguish/why). |
| Spaced / distributed practice | ◐ | SM-2 engine is solid, but **review is siloed** from the path — nothing surfaces due cards before the next chapter. |
| Feedback quality | ⚠️ | **Source-orphaned**: shows ✓/✗ + the answer name, but withholds the `signal` + `source` sentence you already store. |
| Generation / desirable difficulty | ◐ | Strong at the skeleton (free text); everything after is recognition (MCQ). No **pretesting** (guess-before-reveal) on concepts. |
| Interleaving | ◐ | The chapter-walk **blocks by section**; the exam interleaves. Blocking-then-interleaving is fine for first acquisition — just ensure quizzes/review mix across sections. |
| Elaboration / self-explanation | ⚠️ | Prereq DAG is shown but not used to drive a "why/because" step; no self-explanation prompts. |
| Metacognition / calibration | ⚠️ | Mastery % shown, but no confidence judgments or calibration feedback (see Part 1 #4). |

### The highest-impact flow gaps (research-backed)

**A. Ground feedback in the source. [verified the data exists] — do this first**
Effective feedback is specific and exemplar-rooted; a bare answer label is the weakest form. You already have `concept.signal` (the definition) and `concept.source` (the book sentence). After a wrong answer, show: *"✗ It's **X**. Why: {signal}. From the text: {source}."* Low effort, large effect, and it reuses data you're currently hiding.

**B. Weave spaced review into the daily flow. [review]**
Lock-in adds concepts to the SR queue, but the path never *surfaces* due cards — a learner can run a whole chapter and never hit review. Distributed practice only works if the review loop is *encountered*. **Fix:** open a study session with "N concepts due — refresh first?" and/or interleave a few due cards into the chapter. (Pairs with Part 1 #1 so "due" reflects real forgetting.)

**C. Add a guess-before-reveal to concept steps (pretesting). [review]**
Concept learning is "show definition → quick-check" (posttest). The **pretesting effect** shows that *guessing before* seeing the answer — even wrong (errorful generation) — beats studying the correct answer outright, by making the knowledge gap salient. You already do this for the skeleton; extend the same recall-then-reveal to each concept. ([Pretesting vs posttesting (Pan & Sana)](https://www.semanticscholar.org/paper/Pretesting-versus-posttesting:-Comparing-the-of-and-Pan-Sana/d5a5407ba23e9fcb9b9e9c15ae4147ed1af6396d), [Pretesting effect (Richland/Kornell/Kao)](https://learninglab.uchicago.edu/Pre-Testing_files/RichlandKornellKao.pdf))

**D. Use the prerequisite DAG pedagogically. [review]**
You compute ready/locked/mastered gates but don't act on them — a "learn X first" nudge (or a why-this-builds-on-that line) turns the DAG from a label into a learning sequence.

### Two audit claims I'd push back on
- **"The sequence is inverted; quiz before read."** Overstated. *orient → learn(concepts) → read* is a legitimate *advance-organizer* design (build the frame, meet concepts, then read the source with structure in mind). The research on test-vs-read ordering is mixed; the higher-confidence move is making each concept step a *pretest+posttest* (item C), not reshuffling whole stages. If you do touch ordering, the cleaner question is whether **exam is redundant with the concept quizzes** (both interleaved concept MCQs) — consider making the exam *adaptive to weak concepts* rather than a second random pass.
- **"SR is fully siloed."** At the data layer it's not — review grades *do* feed mastery. It's siloed in the *UX* (not surfaced in the path), which is item B.

---

## PART 3 — Prioritized recommendations

**P0 — track the right thing (small, high-leverage, mostly `mastery.py`)**
1. Decay from the SM-2 interval (retrievability ← stability), not a fixed τ. Reuses data you already store.
2. Record the skeleton/free-recall self-grade as a study event so generation feeds mastery.
3. Resolve the "Hard"-grade contradiction between mastery and the scheduler.

**P1 — close the learning loop (flow)**
4. Source-grounded feedback (show `signal` + `source` on wrong answers).
5. Surface due reviews in the path (session warm-up / interleave), now that "due" means something.
6. Guess-before-reveal on concept steps (pretesting).

**P2 — depth & metacognition**
7. Confidence + latency capture → calibration feedback ("you're overconfident on X").
8. Use the prereq DAG to sequence/nudge.
9. Weight the heatmap by retrieval/effort, not raw event rows; make the exam target weak concepts.

All of the above keep your stance: recall-first rigor, no XP/streaks/mascots — these add *fidelity* to what you measure and *close the feedback loop*, not gamified noise.

I haven't changed any code — this is the review you asked for. Tell me which items to implement and I'll start (I'd suggest P0 #1 + P1 #4 first: the biggest correctness and learning wins for the least surface area).

---

**Sources:** [FSRS vs SM-2](https://www.diane.app/en/guides/fsrs-vs-sm2) · [Anki FSRS FAQ](https://faqs.ankiweb.net/what-spaced-repetition-algorithm) · [Pretesting vs posttesting (Pan & Sana)](https://www.semanticscholar.org/paper/Pretesting-versus-posttesting:-Comparing-the-of-and-Pan-Sana/d5a5407ba23e9fcb9b9e9c15ae4147ed1af6396d) · [The pretesting effect (Richland, Kornell, Kao)](https://learninglab.uchicago.edu/Pre-Testing_files/RichlandKornellKao.pdf) · [Interleaved pretesting enhances category learning](https://sc-pan.github.io/pdf/PSM_2024.pdf) · [Knowledge tracing & mastery measurement](https://arxiv.org/html/2502.19915v1) · [Learning analytics overview](https://en.wikipedia.org/wiki/Learning_analytics)
