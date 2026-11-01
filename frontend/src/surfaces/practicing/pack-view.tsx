"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/kit/ui/button"
import { cn } from "@/kit/lib/utils"
import { MarkdownReader } from "@/surfaces/reading"
import { GRADES } from "@/surfaces/studying"
import {
  fetchPack,
  fetchResults,
  fetchReviewSet,
  fetchSitting,
  fetchToday,
  fetchUnit,
  finishSitting,
  gradeSkill,
  markWritten,
  saveProgress,
  saveSitAnswer,
  startSitting,
  type LearnQuestion,
  type LearnUnit,
  type Pack,
  type PlanStep,
  type SitAnswer,
  type Sitting,
  type SittingResults,
  type Step,
  type Today,
} from "@/gateways/api/packs"

/** One exam pack. Today says what to do now, Learn walks one chapter at a time, Exam is a
 *  timed booklet, Results marks it. Nothing that reveals an answer reaches the Exam tab: the
 *  server withholds it until the paper is finished. */

type Tab = "today" | "learn" | "exam" | "results"
const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "learn", label: "Learn" },
  { id: "exam", label: "Exam" },
  { id: "results", label: "Results" },
]
const LETTERS = "ABCDE"
const cite = (key: string) => `§ ${key.replace(/^toc:/, "")}`

function Prose({ text }: { text: string }) {
  return <MarkdownReader content={text} proseSize="sm" className="mx-0 max-w-none text-left" />
}

export function PackView({ packKey, onBack }: { packKey: string; onBack: () => void }) {
  const [pack, setPack] = useState<Pack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("today")
  const [unitKey, setUnitKey] = useState<string | null>(null)
  const [sitKey, setSitKey] = useState<string | null>(null)
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [clock, setClock] = useState<string | null>(null)
  const [low, setLow] = useState(false)

  const load = useCallback(() => {
    fetchPack(packKey).then(setPack).catch((e) => setError(String(e.message ?? e)))
  }, [packKey])
  useEffect(load, [load])

  const building = pack?.units.some((u) => u.status === "queued" || u.status === "building")
  useEffect(() => {
    if (!building) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [building, load])

  const onClock = useCallback((c: string | null, l: boolean) => {
    setClock(c)
    setLow(l)
  }, [])

  const lastFinished = pack?.sittings.find((s) => s.status === "finished")?.key ?? null
  const shownResult = resultKey ?? lastFinished

  if (error) return <div className="study-page p-6"><div className="study-note warn text-sm">{error}</div></div>
  if (!pack) return <div className="study-page p-6 text-sm text-muted-foreground">Loading the pack…</div>

  const go = (step: PlanStep) => {
    if (step.kind === "learn") {
      setUnitKey(step.unitKey)
      setTab("learn")
    } else if (step.kind === "exam") setTab("exam")
    else if (step.kind === "weak") setTab("results")
  }

  return (
    <div className="study-page">
      <header className="study-bar">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div className="mr-auto min-w-0">
            <div className="truncate font-semibold">{pack.title}</div>
            <button type="button" onClick={onBack} className="text-xs text-muted-foreground hover:underline">
              All packs
            </button>
          </div>
          <div className="study-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="text-sm font-medium" onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {clock && tab === "exam" && <div className={cn("study-clock", low && "low")}>{clock}</div>}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {tab === "today" && <TodayTab pack={pack} onGo={go} onChanged={load} />}
        {tab === "learn" && <LearnTab pack={pack} unitKey={unitKey} setUnitKey={setUnitKey} onChanged={load} />}
        {tab === "exam" && (
          <ExamTab
            pack={pack}
            sitKey={sitKey}
            setSitKey={setSitKey}
            onClock={onClock}
            onFinished={(key) => {
              setSitKey(null)
              setClock(null)
              setResultKey(key)
              load()
              setTab("results")
            }}
          />
        )}
        {tab === "results" && <ResultsTab pack={pack} sitting={shownResult} onPick={setResultKey} onChanged={load} />}
      </main>
    </div>
  )
}

function TodayTab({ pack, onGo, onChanged }: { pack: Pack; onGo: (s: PlanStep) => void; onChanged: () => void }) {
  const [today, setToday] = useState<Today | null>(null)
  const [review, setReview] = useState<LearnQuestion[] | null>(null)
  useEffect(() => {
    fetchToday(pack.key).then(setToday).catch(() => undefined)
  }, [pack])

  const openReview = () => fetchReviewSet(pack.key).then((r) => setReview(r.questions))
  const now = today?.now
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BuildNotice pack={pack} />
      {now ? (
        <section className="study-sheet flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Do this now</span>
          <h2 className="text-lg font-semibold">{now.title}</h2>
          {now.minutes != null && <span className="font-mono text-xs tabular-nums text-muted-foreground">{now.minutes} min</span>}
          <div>
            <Button onClick={() => (now.kind === "review" ? openReview() : onGo(now))}>Start</Button>
          </div>
        </section>
      ) : (
        <div className="study-sheet text-sm text-muted-foreground">Nothing is ready yet. Finished chapters appear here as they build.</div>
      )}
      {review && (
        <section className="flex flex-col gap-3">
          {review.length === 0 && <div className="study-sheet text-sm text-muted-foreground">No questions could be drawn for your due skills.</div>}
          {review.map((q) => (
            <QuestionCard key={q.itemKey + q.stem} q={q} packKey={pack.key} onAnswered={onChanged} />
          ))}
        </section>
      )}
      {today && today.next.length > 0 && (
        <section className="study-sheet flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Then{today.examDate ? ` · exam ${today.examDate}` : ""}
          </span>
          {today.next.map((s, i) => (
            <button key={i} type="button" onClick={() => onGo(s)} className="flex justify-between gap-3 rounded-md p-1.5 text-left text-sm hover:bg-muted">
              <span>{s.title}</span>
              {s.minutes != null && <span className="font-mono text-xs tabular-nums text-muted-foreground">{s.minutes} min</span>}
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

function BuildNotice({ pack }: { pack: Pack }) {
  const ready = pack.units.filter((u) => u.status === "ready").length
  const failed = pack.units.filter((u) => u.status === "failed")
  if (ready === pack.units.length) return null
  return (
    <div className={cn("study-note text-sm", failed.length > 0 && "warn")}>
      {ready} of {pack.units.length} chapters ready. Finished chapters open now.
      {failed.map((u) => (
        <div key={u.key}>{u.title} failed: {u.receipt?.error}</div>
      ))}
    </div>
  )
}

/** A choice question marked on the spot, or a problem with no key that you check yourself. */
function QuestionCard({ q, packKey, onAnswered }: { q: LearnQuestion; packKey: string; onAnswered?: (ok: boolean) => void }) {
  const [pick, setPick] = useState<number | null>(null)
  const [shown, setShown] = useState(false)
  const [selfMarked, setSelfMarked] = useState(false)
  const key = typeof q.answer === "number" ? q.answer : null
  const hasChoices = (q.choices?.length ?? 0) > 0 && key != null

  const choose = (i: number) => {
    if (pick != null) return
    setPick(i)
    const ok = i === key
    gradeSkill(packKey, q.skill, ok).catch(() => undefined)
    onAnswered?.(ok)
  }
  const selfMark = (ok: boolean) => {
    setSelfMarked(true)
    gradeSkill(packKey, q.skill, ok).catch(() => undefined)
    onAnswered?.(ok)
  }
  const missed = pick != null && pick !== key
  return (
    <article className="study-sheet flex flex-col gap-3">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{q.skillLabel}</span>
        <span className="font-mono">{q.origin === "book_problem" ? "book problem" : q.origin === "variant" ? "variant of book problem" : "generated"} · {cite(q.sectionKey)}</span>
      </div>
      <Prose text={q.stem} />
      {hasChoices ? (
        <div className="flex flex-col gap-2">
          {q.choices?.map((c, i) => (
            <button key={i} type="button" disabled={pick != null} onClick={() => choose(i)}
              className={cn("study-choice", pick != null && i === key && "right", pick === i && i !== key && "wrong")}>
              <span className="study-letter text-xs font-semibold">{LETTERS[i]}</span>
              <span className="whitespace-pre-wrap text-sm">{c}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(q.choices ?? []).map((c, i) => <div key={i} className="text-sm">{LETTERS[i]}. {c}</div>)}
          {!shown ? (
            <div><Button variant="outline" size="sm" onClick={() => setShown(true)}>Show answer</Button></div>
          ) : (
            <>
              <div className="study-note text-sm">{q.printedAnswer || "The book prints no answer here, so check this one against the section cited."}</div>
              {!selfMarked && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => selfMark(false)}>I missed it</Button>
                  <Button variant="outline" size="sm" onClick={() => selfMark(true)}>I got it</Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {pick != null && q.explain && <div className="study-note text-sm">{q.explain}</div>}
      {missed && q.steps && q.steps.length > 0 && <Walk steps={q.steps} />}
    </article>
  )
}

/** Reveal one step at a time: the Exam Generator's Learn mode. */
function Walk({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(0)
  return (
    <ol className="flex flex-col gap-2">
      {steps.slice(0, open + 1).map((s, i) => (
        <li key={i} className="rounded-md border p-2 text-sm">
          <div className="font-medium">Step {i + 1}. {s.ask}</div>
          {i < open && s.show && <div className="mt-1 whitespace-pre-wrap font-mono text-xs text-brand">{s.show}</div>}
        </li>
      ))}
      <li>
        {open < steps.length ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(open + 1)}>Reveal step</Button>
        ) : (
          <span className="text-xs text-muted-foreground">All steps shown.</span>
        )}
      </li>
    </ol>
  )
}

function LearnTab({ pack, unitKey, setUnitKey, onChanged }: { pack: Pack; unitKey: string | null; setUnitKey: (k: string) => void; onChanged: () => void }) {
  const ready = pack.units.filter((u) => u.status === "ready")
  const active = unitKey ?? ready[0]?.key ?? null
  const [unit, setUnit] = useState<LearnUnit | null>(null)
  const [part, setPart] = useState<"chunk" | "steps" | "test">("chunk")
  const [score, setScore] = useState({ good: 0, total: 0 })

  useEffect(() => {
    if (!active) return
    setUnit(null)
    setScore({ good: 0, total: 0 })
    fetchUnit(pack.key, active).then((u) => {
      setUnit(u)
      setPart(!u.progress.chunk ? "chunk" : !u.progress.steps ? "steps" : "test")
    })
  }, [pack.key, active])

  const done = (stage: "chunk" | "steps") => {
    if (!active) return
    saveProgress(pack.key, active, { [stage]: true }).then(onChanged)
    setPart(stage === "chunk" ? "steps" : "test")
  }
  const answered = (ok: boolean) => {
    if (!active || !unit) return
    const next = { good: score.good + (ok ? 1 : 0), total: score.total + 1 }
    setScore(next)
    if (next.total >= unit.test.length) saveProgress(pack.key, active, { test: next }).then(onChanged)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <nav className="study-stepper" aria-label="Chapters">
        {pack.units.map((u) => (
          <button key={u.key} type="button" className="study-step" disabled={u.status !== "ready"} aria-current={u.key === active} onClick={() => setUnitKey(u.key)}>
            <span className="block whitespace-nowrap text-sm font-medium">{u.title}{u.progress.test ? " ✓" : ""}</span>
            <span className="block font-mono text-micro text-muted-foreground">
              {u.status === "ready" ? (u.progress.test ? `${u.progress.test.good}/${u.progress.test.total}` : "ready") : u.status}
            </span>
          </button>
        ))}
      </nav>
      {!active && <div className="study-sheet text-sm text-muted-foreground">No chapter has finished building yet.</div>}
      {unit && (
        <>
          <div className="study-tabs self-start" role="tablist">
            {(["chunk", "steps", "test"] as const).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={part === p} className="text-sm font-medium" onClick={() => setPart(p)}>
                {p === "chunk" ? "1 · Chunk" : p === "steps" ? "2 · Steps" : "3 · Test"}
              </button>
            ))}
          </div>

          {part === "chunk" && (
            <section className="study-sheet flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                {unit.chunk?.source === "book_summary" ? "Compressed from the book's summary and sections." : "The book has no summary here, so this is compressed from its sections."}
              </p>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
                {unit.chunk?.points.map((p, i) => (
                  <li key={i}>{p.text} <span className="font-mono text-micro text-muted-foreground">{cite(p.sectionKey)}</span></li>
                ))}
              </ul>
              <div><Button onClick={() => done("chunk")}>On to the steps</Button></div>
            </section>
          )}

          {part === "steps" && (
            <section className="flex flex-col gap-3">
              {unit.worked.map((w) => (
                <article key={w.itemKey} className="study-sheet flex flex-col gap-3">
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span>{w.skillLabel}</span><span className="font-mono">{cite(w.sectionKey)}</span>
                  </div>
                  <Prose text={w.stem} />
                  <Walk steps={w.steps ?? []} />
                </article>
              ))}
              {unit.bookProblems.length > 0 && <h3 className="font-semibold">From the book</h3>}
              {unit.bookProblems.map((q) => <QuestionCard key={q.itemKey} q={q} packKey={pack.key} />)}
              <div><Button onClick={() => done("steps")}>On to the test</Button></div>
            </section>
          )}

          {part === "test" && (
            <section className="flex flex-col gap-3">
              {unit.test.length === 0 && <div className="study-sheet text-sm text-muted-foreground">No test questions for this chapter. The receipt on Results says why.</div>}
              {unit.test.map((q) => <QuestionCard key={q.itemKey + q.stem} q={q} packKey={pack.key} onAnswered={answered} />)}
              {unit.test.length > 0 && <div className="font-mono text-sm tabular-nums">{score.good}/{score.total} of {unit.test.length}</div>}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function ExamTab({ pack, sitKey, setSitKey, onClock, onFinished }: {
  pack: Pack
  sitKey: string | null
  setSitKey: (k: string) => void
  onClock: (c: string | null, low: boolean) => void
  onFinished: (key: string) => void
}) {
  const openKey = sitKey ?? pack.sittings.find((s) => s.status === "open")?.key ?? null
  const [sit, setSit] = useState<Sitting | null>(null)
  const [at, setAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const fmt = pack.config.format
  const finishing = useRef(false)
  const startedAt = sit?.startedAt
  const minutes = sit?.minutes
  const sitId = sit?.key

  useEffect(() => {
    if (openKey) fetchSitting(openKey).then(setSit).catch((e) => setError(String(e.message ?? e)))
  }, [openKey])

  const finish = useCallback(async () => {
    if (!sitId || finishing.current) return
    finishing.current = true
    await finishSitting(sitId)
    onFinished(sitId)
  }, [sitId, onFinished])

  useEffect(() => {
    if (!startedAt || !minutes) return
    const end = startedAt + minutes * 60
    const tick = () => {
      const left = Math.max(0, Math.round(end - Date.now() / 1000))
      onClock(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, left < 300)
      if (left === 0) void finish()
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => { clearInterval(t); onClock(null, false) }
  }, [startedAt, minutes, finish, onClock])

  if (!sit)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <BuildNotice pack={pack} />
        {error && <div className="study-note warn text-sm">{error}</div>}
        <section className="study-sheet flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{pack.sittings.some((s) => s.status === "finished") ? "Sit a fresh paper" : "Sit your first paper"}</h2>
          <p className="text-sm text-muted-foreground">
            {fmt.count} questions · {fmt.minutes} minutes · {fmt.closedBook ? "closed book" : "open book"}. Only questions you haven&apos;t seen. Nothing is marked until you submit.
          </p>
          <div>
            <Button disabled={!pack.units.some((u) => u.status === "ready")} onClick={() => startSitting(pack.key).then((s) => { setSit(s); setSitKey(s.key) }).catch((e) => setError(String(e.message ?? e)))}>
              Start the clock
            </Button>
          </div>
        </section>
      </div>
    )

  const q = sit.questions[at]
  const a: SitAnswer = sit.answers[q.key] ?? {}
  const update = (patch: SitAnswer) => {
    const next = { ...a, ...patch }
    setSit({ ...sit, answers: { ...sit.answers, [q.key]: next } })
    saveSitAnswer(sit.key, q.key, next).catch((e) => setError(String(e.message ?? e)))
  }
  const answered = Object.values(sit.answers).filter((x) => x.choice != null || x.response).length

  return (
    <div className="study-booklet">
      <section className="study-sheet flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-semibold">Question {at + 1}</span>
          <span className="text-xs text-muted-foreground">{q.skillLabel} · {cite(q.sectionKey)}</span>
        </div>
        <Prose text={q.stem} />
        {q.qtype === "choice" ? (
          <div className="flex flex-col gap-2">
            {q.choices?.map((c, i) => (
              <button key={i} type="button" className={cn("study-choice", a.choice === i && "sel")} onClick={() => update({ choice: i })}>
                <span className="study-letter text-xs font-semibold">{LETTERS[i]}</span>
                <span className="whitespace-pre-wrap text-sm">{c}</span>
              </button>
            ))}
          </div>
        ) : (
          <textarea className="study-input" rows={7} value={a.response ?? ""} onChange={(e) => update({ response: e.target.value })} placeholder="Write your answer. You'll mark it against the worked solution on Results." />
        )}
        {error && <div className="study-note warn text-sm">{error}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={at === 0} onClick={() => setAt(at - 1)}>Previous</Button>
          <Button variant="outline" size="sm" onClick={() => update({ flag: !a.flag })}>{a.flag ? "Unflag" : "Flag"}</Button>
          <span className="flex-1" />
          <Button size="sm" disabled={at === sit.questions.length - 1} onClick={() => setAt(at + 1)}>Next</Button>
        </div>
      </section>
      <aside className="study-sheet flex flex-col gap-3">
        <span className="text-xs font-medium text-muted-foreground">Answer sheet · {answered}/{sit.questions.length}</span>
        <div className="study-grid">
          {sit.questions.map((x, i) => {
            const v = sit.answers[x.key]
            return (
              <button key={x.key} type="button" onClick={() => setAt(i)} className={cn("study-cell font-mono text-xs", (v?.choice != null || v?.response) && "ans", i === at && "cur", v?.flag && "flag")}>
                {i + 1}
              </button>
            )
          })}
        </div>
        {sit.shortBy > 0 && <div className="study-note warn text-xs">This paper is {sit.shortBy} short: the pool ran out of unseen questions.</div>}
        {!confirming ? (
          <Button onClick={() => setConfirming(true)}>Submit paper</Button>
        ) : (
          <div className="study-note warn flex flex-col gap-2 text-sm">
            <span>{sit.questions.length - answered} unanswered. Submit now?</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void finish()}>Submit</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Keep going</Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

function pct(good: number, total: number) {
  return total ? Math.round((good / total) * 100) : 0
}

function Row({ label, good, total, pending }: { label: string; good: number; total: number; pending: number }) {
  const p = pct(good, total)
  return (
    <div className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
      <span className="truncate">{label}</span>
      <div className="study-track"><i className={cn(p < 50 ? "low" : p < 80 && "mid")} style={{ width: `${p}%` }} /></div>
      <span className="text-right font-mono text-xs tabular-nums">{good}/{total}{pending ? ` +${pending}` : ""}</span>
    </div>
  )
}

function ResultsTab({ pack, sitting, onPick, onChanged }: { pack: Pack; sitting: string | null; onPick: (k: string) => void; onChanged: () => void }) {
  const [res, setRes] = useState<SittingResults | null>(null)
  useEffect(() => {
    if (sitting) fetchResults(sitting).then(setRes).catch(() => setRes(null))
  }, [sitting])
  const title = useMemo(() => Object.fromEntries(pack.units.map((u) => [u.key, u.title])), [pack.units])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {!sitting && <div className="study-sheet text-sm text-muted-foreground">Sit a paper and your results land here.</div>}
      {res && (
        <>
          <section className="study-sheet flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-4">
              <span className="font-mono text-3xl font-semibold tabular-nums">{pct(res.score.good, res.score.total)}%</span>
              <span className="text-sm text-muted-foreground">{res.score.good} of {res.score.total}</span>
              {res.score.provisional && <span className="text-sm text-status-due">Provisional: {res.score.pending} written still to mark below</span>}
            </div>
            {res.shortBy > 0 && <div className="study-note warn text-sm">This paper came up {res.shortBy} short: the pool ran out of unseen questions.</div>}
            <h3 className="font-semibold">By chapter</h3>
            {Object.entries(res.score.units).map(([k, b]) => <Row key={k} label={title[k] ?? k} {...b} />)}
            <h3 className="font-semibold">By skill</h3>
            {Object.entries(res.score.skills).map(([k, b]) => <Row key={k} label={b.label ?? k} {...b} />)}
          </section>
          {res.questions.map((q, i) => {
            const a = res.answers[q.key] ?? {}
            const ok = res.score.verdicts[q.key]
            return (
              <article key={q.key} className="study-sheet flex flex-col gap-3">
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <span>Question {i + 1} · {q.skillLabel}</span>
                  <span className="font-mono">{ok == null ? "to mark" : ok ? "right" : "missed"} · {cite(q.sectionKey)}</span>
                </div>
                <Prose text={q.stem} />
                {q.qtype === "choice" ? (
                  <div className="flex flex-col gap-2">
                    {q.choices?.map((c, n) => (
                      <div key={n} className={cn("study-choice", n === q.answer && "right", a.choice === n && n !== q.answer && "wrong")}>
                        <span className="study-letter text-xs font-semibold">{LETTERS[n]}</span>
                        <span className="whitespace-pre-wrap text-sm">{c}</span>
                      </div>
                    ))}
                    {a.choice != null && q.why?.[String(a.choice)] && <div className="study-note warn text-sm">Likely mistake: {q.why[String(a.choice)]}</div>}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="whitespace-pre-wrap rounded-md border p-2 text-sm">{a.response || "No answer written."}</div>
                    <div className="study-note text-sm">
                      <div className="whitespace-pre-wrap">{String(q.answer ?? "")}</div>
                      {q.rubric && <div className="mt-1 text-xs text-muted-foreground">{q.rubric}</div>}
                    </div>
                    {a.selfGrade == null && (
                      <div className="flex flex-wrap gap-2">
                        {GRADES.map((g) => (
                          <Button key={g.grade} variant="outline" size="sm" onClick={() => markWritten(res.key, q.key, g.grade).then((r) => { setRes(r); onChanged() })}>
                            {g.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {q.explain && <div className="study-note text-sm">{q.explain}</div>}
                {ok === false && q.steps && q.steps.length > 0 && <Walk steps={q.steps} />}
              </article>
            )
          })}
        </>
      )}
      {pack.sittings.length > 0 && (
        <section className="study-sheet flex flex-col gap-1">
          <h3 className="font-semibold">Past sittings</h3>
          {pack.sittings.filter((s) => s.status === "finished").map((s) => (
            <button key={s.key} type="button" onClick={() => onPick(s.key)} className="flex justify-between rounded-md p-1.5 text-left text-sm hover:bg-muted">
              <span>{new Date(s.startedAt * 1000).toLocaleString()}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{s.questions} questions</span>
            </button>
          ))}
        </section>
      )}
      <section className="study-sheet flex flex-col gap-2">
        <h3 className="font-semibold">Build receipt</h3>
        {pack.units.map((u) => (
          <details key={u.key} className="text-sm">
            <summary className="cursor-pointer">
              {u.title}: {u.status === "ready" ? `${u.receipt?.kept ?? 0} kept, ${u.receipt?.droppedCount ?? 0} dropped` : u.status}
              {u.receipt?.thin ? ` · thin (${u.receipt.capacity} unseen for a share of ${u.receipt.share})` : ""}
            </summary>
            <div className="mt-1 text-xs text-muted-foreground">
              {u.receipt?.source === "book_summary" ? "Used the book's summary" : "No book summary"} · {u.receipt?.bookProblems ?? 0} book problems · {u.receipt?.skills ?? 0} skills
              {u.receipt?.error && <div>{u.receipt.error}</div>}
            </div>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {u.receipt?.dropped?.map((d, i) => <li key={i}>{d.kind}: {d.what} ({d.reason})</li>)}
            </ul>
          </details>
        ))}
      </section>
    </div>
  )
}
