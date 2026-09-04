"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, FileText, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { MarkdownReader, type ReadingPrefs, type ReadingTheme } from "@/surfaces/reading"
import { displaySectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { GRADES } from "@/surfaces/studying"
import {
  createExam,
  fetchExam,
  fetchExamResults,
  fetchExams,
  finishExam,
  gradeExamAnswer,
  resitExam,
  saveExamAnswer,
  type ExamResults,
  type ExamSitting,
  type ExamSummary,
} from "@/gateways/api/exams"
import { cn } from "@/kit/lib/utils"

/** Exams — sit a frozen paper, then mark it.
 *
 *  The one thing that separates this from the practice session: **you write your answer
 *  before you can see the worked solution.** The practice loop reveals on demand, which is
 *  right for spaced practice and useless as an audit — "I knew that" is the easiest lie in
 *  studying. So the paper is answered first, submitted, and only then walked and graded.
 *
 *  Three screens, one mode: SETUP picks the chapters, RUNNER is the paper, RESULTS is the
 *  marking walk plus the per-section breakdown that says which chapter let you down. */

type Screen =
  | { at: "setup" }
  | { at: "sitting"; key: string }
  | { at: "results"; key: string }

export function ExamMode({
  docId,
  tree,
  loading,
  theme,
  prefs,
  onGraded,
}: {
  docId: string
  tree: LearnTreeNode[]
  loading: boolean
  theme: ReadingTheme
  prefs: ReadingPrefs
  onGraded?: () => void
}) {
  const [screen, setScreen] = useState<Screen>({ at: "setup" })

  if (screen.at === "sitting")
    return (
      <ExamRunner
        key={screen.key}
        examKey={screen.key}
        docId={docId}
        theme={theme}
        prefs={prefs}
        onFinished={() => setScreen({ at: "results", key: screen.key })}
        onQuit={() => setScreen({ at: "setup" })}
      />
    )
  if (screen.at === "results")
    return (
      <ExamResultsView
        key={screen.key}
        examKey={screen.key}
        docId={docId}
        theme={theme}
        prefs={prefs}
        onGraded={onGraded}
        onSit={(k) => setScreen({ at: "sitting", key: k })}
        onDone={() => setScreen({ at: "setup" })}
      />
    )
  return (
    <ExamSetup
      docId={docId}
      tree={tree}
      loading={loading}
      onSit={(k) => setScreen({ at: "sitting", key: k })}
      onOpenResults={(k) => setScreen({ at: "results", key: k })}
    />
  )
}

// ── Setup ───────────────────────────────────────────────────────────────────

function ExamSetup({
  docId,
  tree,
  loading,
  onSit,
  onOpenResults,
}: {
  docId: string
  tree: LearnTreeNode[]
  loading: boolean
  onSit: (key: string) => void
  onOpenResults: (key: string) => void
}) {
  const chapters = useMemo(() => tree.filter((n) => n.sectionKey), [tree])
  const [picked, setPicked] = useState<string[]>([])
  const [perChapter, setPerChapter] = useState(5)
  const [past, setPast] = useState<ExamSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPast = useCallback(() => {
    fetchExams(docId)
      .then((d) => setPast(d.exams ?? []))
      .catch(() => setPast([]))
  }, [docId])

  useEffect(loadPast, [loadPast])

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const exam = await createExam(docId, picked, perChapter)
      if (exam.error) throw new Error(exam.error)
      onSit(exam.key)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assemble a paper")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1 space-y-4">
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-medium">Set a paper</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick the chapters to be examined on. You answer every question before seeing any
            worked solution — that is the whole point.
          </p>

          <div className="mt-3 max-h-72 space-y-0.5 overflow-y-auto rounded border p-1">
            {loading && !chapters.length ? (
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)
            ) : (
              chapters.map((c) => {
                const key = c.sectionKey as string
                const on = picked.includes(key)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(key)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs",
                      on ? "bg-brand/15 font-medium text-brand" : "hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-micro",
                        on ? "border-brand bg-brand text-background" : "border-border",
                      )}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {displaySectionTitle(c.label, c.title)}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              Questions per chapter
              <input
                type="number"
                min={1}
                max={20}
                value={perChapter}
                onChange={(e) => setPerChapter(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="h-8 w-16 rounded border bg-background px-2 text-xs"
              />
            </label>
            <span className="text-xs text-muted-foreground">
              {picked.length
                ? `${picked.length} chapter${picked.length === 1 ? "" : "s"} · up to ${picked.length * perChapter} questions`
                : "no chapters picked"}
            </span>
            <Button
              type="button"
              size="sm"
              className="ml-auto h-8"
              disabled={busy || !picked.length}
              onClick={() => void start()}
            >
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Start the exam
            </Button>
          </div>

          {error && (
            <p className="mt-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </section>
      </div>

      <aside className="w-72 shrink-0">
        <h3 className="mb-2 text-xs font-medium">Past sittings</h3>
        {!past.length ? (
          <p className="text-xs text-muted-foreground">Nothing sat yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {past.map((e) => (
              <li key={e.key}>
                {/* An unfinished paper resumes into the RUNNER. Opening the marking screen
                    for a sitting you have not submitted would show you the worked solutions
                    to questions you still have to answer — the one thing an exam must not
                    do. Found by reloading mid-paper. */}
                <button
                  type="button"
                  onClick={() => (e.status === "open" ? onSit(e.key) : onOpenResults(e.key))}
                  className="w-full rounded border px-3 py-2 text-left text-xs hover:border-foreground/40"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {e.status === "open" ? "Resume" : "Sat"}
                      {e.resitOf && " · resit"}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {e.score?.fraction != null
                        ? `${Math.round(e.score.fraction * 100)}%`
                        : `${e.answered}/${e.count}`}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-micro text-muted-foreground">
                    {(e.config?.chapters ?? []).length} chapter
                    {(e.config?.chapters ?? []).length === 1 ? "" : "s"} · {e.count} questions
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  )
}

// ── Runner ──────────────────────────────────────────────────────────────────

function ExamRunner({
  examKey,
  docId,
  theme,
  prefs,
  onFinished,
  onQuit,
}: {
  examKey: string
  docId: string
  theme: ReadingTheme
  prefs: ReadingPrefs
  onFinished: () => void
  onQuit: () => void
}) {
  const [exam, setExam] = useState<ExamSitting | null>(null)
  const [idx, setIdx] = useState(0)
  const [draft, setDraft] = useState("")
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchExam(examKey)
      .then((e) => {
        if (!active) return
        if (e.error) setError(e.error)
        else {
          setExam(e)
          // Resume where it was left: answers live on the row, not in this component.
          const responses: Record<string, string> = {}
          for (const [k, v] of Object.entries(e.answers ?? {})) {
            if (v?.response) responses[k] = v.response
          }
          setSaved(responses)
          const firstUnanswered = e.questions.findIndex((q) => !responses[q.key])
          setIdx(firstUnanswered === -1 ? 0 : firstUnanswered)
        }
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Could not load the paper"))
    return () => {
      active = false
    }
  }, [examKey])

  const q = exam?.questions[idx]
  useEffect(() => setDraft(q ? (saved[q.key] ?? "") : ""), [q, saved])

  const persist = useCallback(async () => {
    if (!q) return
    const text = draft
    if ((saved[q.key] ?? "") === text) return
    setSaved((s) => ({ ...s, [q.key]: text }))
    await saveExamAnswer(examKey, q.key, text).catch(() => {})
  }, [q, draft, saved, examKey])

  // Autosave while typing. Saving only on blur and navigation made the promise below —
  // "closing the tab loses nothing" — false for the exact case that matters: writing a long
  // answer and then closing the tab. 800ms after you stop typing, same debounce the
  // documents autosave uses.
  useEffect(() => {
    if (!q || (saved[q.key] ?? "") === draft) return
    const t = setTimeout(() => void persist(), 800)
    return () => clearTimeout(t)
  }, [draft, q, saved, persist])

  async function move(delta: number) {
    await persist()
    setIdx((i) => Math.min((exam?.questions.length ?? 1) - 1, Math.max(0, i + delta)))
  }

  async function submit() {
    setBusy(true)
    await persist()
    await finishExam(examKey).catch(() => {})
    setBusy(false)
    onFinished()
  }

  if (error) return <p className="rounded-lg border bg-card p-6 text-sm text-destructive">{error}</p>
  if (!exam || !q)
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Setting the paper…
      </div>
    )

  const answeredCount = exam.questions.filter((x) => (saved[x.key] ?? "").trim()).length

  return (
    <div className="flex gap-5">
      <nav className="w-52 shrink-0 space-y-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">Paper</span>
          <span className="tabular-nums text-muted-foreground">
            {answeredCount}/{exam.questions.length}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {exam.questions.map((x, i) => (
            <button
              key={x.key}
              type="button"
              onClick={() => void persist().then(() => setIdx(i))}
              className={cn(
                "flex h-9 items-center justify-center rounded border text-sm tabular-nums",
                i === idx
                  ? "border-brand bg-brand/15 font-semibold text-brand ring-1 ring-brand"
                  : (saved[x.key] ?? "").trim()
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                    : "border-border text-muted-foreground hover:border-foreground/40",
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <p className="text-micro text-muted-foreground">
          Answers save as you move. Closing the tab loses nothing.
        </p>
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Submit &amp; mark
        </Button>
        <Button type="button" variant="ghost" size="sm" className="w-full text-xs" onClick={onQuit}>
          Leave for now
        </Button>
      </nav>

      <div className="min-w-0 flex-1">
        <article className="rounded-lg border bg-card p-6">
          <header className="mb-4 flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums text-muted-foreground">
              Question {idx + 1} of {exam.questions.length}
            </span>
            <span className="rounded bg-brand/15 px-2 py-0.5 text-micro font-medium uppercase text-brand">
              {q.kind}
            </span>
          </header>

          <MarkdownReader
            content={q.prompt}
            theme={theme}
            proseSize={prefs.size}
            measure={prefs.measure}
            className="mx-0 max-w-none"
          />

          <label className="mt-5 block text-micro font-medium uppercase text-muted-foreground">
            Your answer
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void persist()}
            placeholder="Work it out here — you will see the model answer after you submit."
            className="mt-1 h-56 w-full resize-y rounded border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </article>

        <div className="mt-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={idx === 0}
            onClick={() => void move(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={idx >= exam.questions.length - 1}
            onClick={() => void move(1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Results ─────────────────────────────────────────────────────────────────

function ExamResultsView({
  examKey,
  docId,
  theme,
  prefs,
  onGraded,
  onSit,
  onDone,
}: {
  examKey: string
  docId: string
  theme: ReadingTheme
  prefs: ReadingPrefs
  onGraded?: () => void
  onSit: (key: string) => void
  onDone: () => void
}) {
  const [results, setResults] = useState<ExamResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unscheduled, setUnscheduled] = useState<string[]>([])

  const load = useCallback(() => {
    fetchExamResults(examKey)
      .then((r) => (r.error ? setError(r.error) : setResults(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load results"))
  }, [examKey])

  useEffect(load, [load])

  async function grade(itemKey: string, g: 1 | 2 | 3 | 4) {
    const res = await gradeExamAnswer(examKey, itemKey, g, docId).catch(() => null)
    if (res && res.scheduled === false) setUnscheduled((u) => [...u, itemKey])
    onGraded?.()
    load()
  }

  if (error) return <p className="rounded-lg border bg-card p-6 text-sm text-destructive">{error}</p>
  if (!results)
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Marking…
      </div>
    )

  const { score, bySection, comparison } = results
  const ungraded = results.questions.length - score.graded

  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-section font-semibold tabular-nums">
              {score.fraction != null ? `${Math.round(score.fraction * 100)}%` : "—"}
            </h2>
            <span className="text-sm text-muted-foreground">
              {score.good} of {score.graded} answered well
              {ungraded > 0 && ` · ${ungraded} still to mark`}
            </span>
            {comparison?.score?.fraction != null && (
              <span className="ml-auto text-xs text-muted-foreground">
                previous sitting {Math.round(comparison.score.fraction * 100)}%
                {score.fraction != null && (
                  <strong
                    className={cn(
                      "ml-1",
                      score.fraction >= comparison.score.fraction
                        ? "text-emerald-400"
                        : "text-rose-400",
                    )}
                  >
                    {score.fraction >= comparison.score.fraction ? "▲" : "▼"}
                    {Math.abs(Math.round((score.fraction - comparison.score.fraction) * 100))}
                  </strong>
                )}
              </span>
            )}
          </div>
          {ungraded > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Mark each answer against its worked solution below. Grades feed the same
              schedule as practice.
            </p>
          )}
        </section>

        {results.questions.map((q, i) => {
          const a = results.answers[q.key] ?? {}
          const graded = a.selfGrade
          return (
            <article key={q.key} className="rounded-lg border bg-card p-5">
              <header className="mb-3 flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="rounded bg-brand/15 px-2 py-0.5 text-micro font-medium uppercase text-brand">
                  {q.kind}
                </span>
                <span className="text-micro text-muted-foreground">{q.sectionKey}</span>
                {graded && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {GRADES.find((g) => g.grade === graded)?.label}
                  </span>
                )}
              </header>

              <MarkdownReader
                content={q.prompt}
                theme={theme}
                proseSize={prefs.size}
                measure={prefs.measure}
                className="mx-0 max-w-none"
              />

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded border border-border/60 p-3">
                  <p className="mb-1 text-micro font-medium uppercase text-muted-foreground">
                    What you wrote
                  </p>
                  <p className="whitespace-pre-wrap font-mono text-xs">
                    {(a.response ?? "").trim() || (
                      <span className="italic text-muted-foreground">left blank</span>
                    )}
                  </p>
                </div>
                <div className="rounded border-l-2 border-brand/50 bg-muted/30 p-3">
                  <p className="mb-1 text-micro font-medium uppercase text-muted-foreground">
                    Worked solution
                  </p>
                  <MarkdownReader
                    content={q.answer}
                    theme={theme}
                    proseSize={prefs.size}
                    measure={prefs.measure}
                    className="mx-0 max-w-none"
                  />
                  {q.rubric && (
                    <p className="mt-2 text-xs italic text-muted-foreground">{q.rubric}</p>
                  )}
                </div>
              </div>

              {unscheduled.includes(q.key) && (
                <p className="mt-2 text-micro text-muted-foreground">
                  This question was regenerated away since you sat it — the mark is kept on
                  your paper but did not move your schedule.
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GRADES.map(({ grade: g, label, cls }) => (
                  <Button
                    key={g}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(cls, graded === g && "ring-1 ring-brand")}
                    onClick={() => void grade(q.key, g)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </article>
          )
        })}
      </div>

      <aside className="w-72 shrink-0 space-y-4">
        <section>
          <h3 className="mb-2 text-xs font-medium">Which chapter let you down</h3>
          <ul className="space-y-1.5">
            {Object.entries(bySection)
              .sort(([, a], [, b]) => (a.graded ? a.good / a.graded : 1) - (b.graded ? b.good / b.graded : 1))
              .map(([section, b]) => {
                const frac = b.graded ? b.good / b.graded : null
                return (
                  <li key={section} className="rounded border px-3 py-2 text-xs">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{section}</span>
                      {/* An UNMARKED section is unknown, not zero: "0/1" reads as "you got
                          none right" when nobody has marked it yet. Same rule the fluency
                          tile follows — an absent measurement is never shown as a bad one. */}
                      <span className="tabular-nums text-muted-foreground">
                        {frac != null ? `${b.good}/${b.graded}` : `— of ${b.total}`}
                      </span>
                    </span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          frac == null ? "bg-muted" : frac >= 0.7 ? "bg-emerald-500" : "bg-rose-500",
                        )}
                        style={{ width: `${(frac ?? 0) * 100}%` }}
                      />
                    </span>
                  </li>
                )
              })}
          </ul>
        </section>

        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() =>
              void resitExam(examKey).then((e) => !e.error && onSit(e.key))
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Sit this paper again
          </Button>
          <Button type="button" variant="ghost" size="sm" className="w-full gap-1.5" onClick={onDone}>
            <FileText className="h-3.5 w-3.5" />
            Back to papers
          </Button>
        </div>
      </aside>
    </div>
  )
}
