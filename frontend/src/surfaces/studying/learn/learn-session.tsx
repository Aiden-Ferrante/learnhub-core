"use client"

/** Learn mode (v0.32.0), layout B from the design canvas (human pick 2026-11-21): the question
 *  on the left, the section's concepts and their stage in a rail on the right.
 *
 *  Pick the definition → explain it in your own words → compare with the book → grade yourself
 *  (Missed it / Partly / Got it). Typed answers are explanations, never one-word terms, and are
 *  self-graded (human). The first self-grade per concept seeds its review card, so learned
 *  concepts come back on the Review card when due. Mount with a fresh `key` per session: the
 *  concepts are a snapshot taken when it starts. */

import Link from "next/link"
import { useCallback, useState } from "react"
import { submitReviewGrade } from "@/gateways/api/review"
import { GRADE_INVALIDATES, unwrap, useApiMutation } from "@/kit/data"
import { cn } from "@/kit/lib/utils"
import { useStudyHotkeys } from "@/surfaces/studying/use-study-hotkeys"
import {
  advance,
  answerPick,
  gradeExplain,
  REVIEW_GRADE,
  startSession,
  type LearnConcept,
  type LearnMode,
  type SelfGrade,
  type Session,
} from "@/surfaces/studying/learn/learn-model"

const STAGE_LABEL = ["Not studied", "Learning", "Mastered"] as const
const STAGE_INK = ["text-muted-foreground", "text-ink-warn", "text-ink-ok"] as const
const GRADES: { g: SelfGrade; label: string; cls: string }[] = [
  { g: 0, label: "Missed it", cls: "border-status-error/50 text-ink-danger" },
  { g: 1, label: "Partly", cls: "border-status-due/50 text-ink-warn" },
  { g: 2, label: "Got it", cls: "border-status-mastered/50 text-ink-ok" },
]

export function LearnSession({
  docId,
  mode,
  concepts,
  pool,
  heading,
  title,
  backHref,
  backLabel,
  bookHref,
  next,
}: {
  docId: string
  mode: LearnMode
  concepts: LearnConcept[]
  pool: LearnConcept[]
  /** The rail's eyebrow, e.g. "Learning · 2.2" or "Due · Chapter 2". */
  heading: string
  title: string
  backHref: string
  backLabel: string
  /** Reread the section in the step reader (learn mode). */
  bookHref?: string
  /** Where the end screen sends you next. */
  next?: { href: string; label: string }
}) {
  const byKey = new Map([...pool, ...concepts].map((c) => [c.key, c]))
  const [s, setS] = useState<Session>(() => startSession(concepts, [...pool, ...concepts], mode))
  const [picked, setPicked] = useState<string | null>(null)
  const [typed, setTyped] = useState("")
  const [revealed, setRevealed] = useState(false)
  const [lastGrade, setLastGrade] = useState<SelfGrade | null>(null)

  const grade = useApiMutation(
    (v: { key: string; g: 1 | 2 | 3 }) => unwrap(submitReviewGrade(v.key, v.g, docId)),
    { invalidates: GRADE_INVALIDATES },
  )

  const step = s.steps[s.i]
  const c = step ? byKey.get(step.key) : undefined
  const done = !step
  const left = s.steps.length - s.i

  const reset = () => {
    setPicked(null)
    setTyped("")
    setRevealed(false)
    setLastGrade(null)
    grade.reset()
  }

  const pick = (k: string) => {
    if (picked || !step || step.kind !== "pick") return
    setPicked(k)
    setS((cur) => answerPick(cur, k))
  }
  const cont = () => {
    setS((cur) => advance(cur))
    reset()
  }
  const selfGrade = useCallback(
    async (g: SelfGrade) => {
      if (!step || step.kind !== "explain" || grade.pending) return
      setLastGrade(g)
      // Only the first grade per concept seeds its review card; repeats are practice.
      if (!(step.key in s.firstGrade)) {
        try {
          await grade.run({ key: step.key, g: REVIEW_GRADE[g] })
        } catch {
          return // "Not saved · Retry" shows; the card stays up
        }
      }
      setS((cur) => gradeExplain(cur, g))
      reset()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is stable in effect
    [step, s.firstGrade, grade],
  )

  useStudyHotkeys((e) => {
    if (!step) return
    if (step.kind === "pick" && !picked && ["1", "2", "3", "4"].includes(e.key)) {
      const k = step.options[Number(e.key) - 1]
      if (k) {
        e.preventDefault()
        pick(k)
      }
    } else if (step.kind === "pick" && picked && e.key === "Enter") {
      e.preventDefault()
      cont()
    } else if (step.kind === "explain" && revealed && ["1", "2", "3"].includes(e.key)) {
      e.preventDefault()
      void selfGrade((Number(e.key) - 1) as SelfGrade)
    }
  })

  const rail = concepts.map((x) => ({ c: x, stage: s.stage[x.key] ?? 0, now: step?.key === x.key }))
  const mastered = rail.filter((r) => r.stage === 2).length
  const misses = Object.values(s.misses).reduce((a, b) => a + b, 0)
  const right = step?.kind === "pick" && picked === step.key
  const pickedName = picked ? byKey.get(picked)?.name : null

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-3 text-meta text-muted-foreground">
        <Link href={backHref} className="hover:text-foreground">
          ← {backLabel}
        </Link>
        <span className="ml-auto tabular-nums">{done ? "Done" : `${left} to go`}</span>
      </div>

      <div className="flex flex-wrap gap-8 pt-8">
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          {done ? (
            <section className="flex flex-col items-start gap-4 pt-4">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-ok">
                {mode === "due" ? "Review done" : `${title} learned`}
              </span>
              <h1 className="m-0 font-serif text-[32px] font-semibold leading-tight">
                {mastered} of {concepts.length} concept{concepts.length === 1 ? "" : "s"} mastered
              </h1>
              <ul className="m-0 flex w-full max-w-[640px] list-none flex-col rounded-2xl border border-border bg-card p-0">
                {concepts.map((x, i) => {
                  const m = s.misses[x.key] ?? 0
                  const g = s.firstGrade[x.key]
                  return (
                    <li key={x.key} className={cn("flex items-center justify-between gap-4 px-5 py-3.5", i > 0 && "border-t border-border")}>
                      <span className="font-semibold">{x.name}</span>
                      <span className={cn("text-meta", m === 0 ? "text-ink-ok" : "text-ink-warn")}>
                        {m === 0 ? "First try" : `Missed ${m === 1 ? "once" : `${m} times`}`}
                        {g !== undefined && g < 2 ? " · back sooner" : ""}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className="m-0 text-sm text-muted-foreground">
                {misses === 0
                  ? "They come back on the Review card when they're due."
                  : "They come back on the Review card when they're due, the shaky ones first."}
              </p>
              <div className="flex flex-wrap gap-3">
                {next && (
                  <Link href={next.href} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
                    {next.label}
                  </Link>
                )}
                <Link href={backHref} className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold hover:border-muted-foreground/50">
                  Back to the chapter
                </Link>
              </div>
            </section>
          ) : (
            c && (
              <>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {step.kind === "pick" ? "Choose the definition" : "Explain it"}
                </span>
                <h1 className="m-0 font-serif text-[34px] font-semibold leading-tight">{c.name}</h1>

                {step.kind === "pick" && (
                  <>
                    <div className="flex flex-col gap-2.5">
                      {step.options.map((k, n) => {
                        const o = byKey.get(k)
                        const isAns = k === step.key
                        const isPick = k === picked
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => pick(k)}
                            disabled={Boolean(picked)}
                            className={cn(
                              "flex min-h-14 items-start gap-3.5 rounded-xl border px-4 py-3.5 text-left text-[15px] leading-relaxed transition-colors",
                              !picked && "border-border bg-card hover:border-muted-foreground/50",
                              picked && isAns && "border-status-mastered bg-status-mastered/10",
                              picked && isPick && !isAns && "border-status-error bg-status-error/10",
                              picked && !isAns && !isPick && "border-border bg-card text-muted-foreground",
                            )}
                          >
                            <span
                              className={cn(
                                "grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-semibold",
                                picked && isAns ? "text-ink-ok" : picked && isPick ? "text-ink-danger" : "bg-muted text-muted-foreground",
                              )}
                            >
                              {picked && isAns ? "✓" : picked && isPick ? "✕" : n + 1}
                            </span>
                            <span>{o?.signal}</span>
                          </button>
                        )
                      })}
                    </div>
                    {picked && (
                      <div
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card px-5 py-4",
                          right ? "border-status-mastered/40" : "border-status-error/40",
                        )}
                      >
                        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
                          <span className={cn("font-semibold", right ? "text-ink-ok" : "text-ink-danger")}>
                            {right ? "Correct" : `You picked the definition of ${pickedName}`}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {right ? "Next you’ll explain it in your own words." : "It comes back before you finish."}
                          </span>
                        </div>
                        <button type="button" onClick={cont} className="min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
                          Continue
                        </button>
                      </div>
                    )}
                  </>
                )}

                {step.kind === "explain" &&
                  (!revealed ? (
                    <div className="flex flex-col gap-2.5">
                      <label htmlFor="learn-explain" className="text-sm text-muted-foreground">
                        In a sentence or two: what is it, and why does it matter?
                      </label>
                      <textarea
                        id="learn-explain"
                        rows={4}
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder="Write it as you’d explain it to a teammate"
                        className="min-h-[120px] resize-y rounded-xl border border-border bg-card px-4 py-3.5 text-base leading-relaxed"
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setRevealed(true)}
                          className="min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
                        >
                          Compare with the book
                        </button>
                        <button
                          type="button"
                          onClick={() => setRevealed(true)}
                          className="min-h-11 px-2 text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          Don’t know, show me
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3.5">
                          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Your answer</span>
                          <p className={cn("m-0 whitespace-pre-wrap text-[15px] leading-relaxed", !typed && "text-muted-foreground")}>
                            {typed || "No answer written."}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3.5">
                          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-accent">The definition</span>
                          <p className="m-0 text-[15px] leading-relaxed">{c.signal}</p>
                          {c.source && (
                            <p className="m-0 border-t border-border pt-2 font-serif text-base italic leading-relaxed text-muted-foreground">
                              “{c.source}”
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2.5">
                        {GRADES.map(({ g, label, cls }) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => void selfGrade(g)}
                            disabled={grade.pending}
                            className={cn("min-h-[52px] rounded-lg border bg-card text-[15px] font-semibold", cls)}
                          >
                            {label} <span className="ml-1 text-xs font-normal text-muted-foreground">{g + 1}</span>
                          </button>
                        ))}
                      </div>
                      {grade.error ? (
                        <p className="m-0 text-meta text-ink-danger">
                          Not saved ·{" "}
                          <button type="button" className="underline" onClick={() => lastGrade !== null && void selfGrade(lastGrade)}>
                            Retry
                          </button>
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground">You grade yourself. Missed it and Partly come back before you finish.</span>
                      )}
                    </div>
                  ))}
              </>
            )
          )}
        </main>

        <aside className="flex flex-[1_1_300px] flex-col gap-4 self-start rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-accent">{heading}</span>
            <span className="font-serif text-xl font-semibold leading-snug">{title}</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm">
            {rail.map((r) => (
              <li key={r.c.key} className={cn("flex justify-between gap-3", r.now && "font-semibold")}>
                <span className="min-w-0">{r.c.name}</span>
                <span className={cn("shrink-0", r.now ? "text-foreground" : STAGE_INK[r.stage])}>
                  {r.now ? "Now" : STAGE_LABEL[r.stage]}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-1" aria-label={`${mastered} of ${concepts.length} mastered`}>
            {rail.map((r) => (
              <span key={r.c.key} className="flex flex-1 gap-0.5">
                <span className={cn("h-[5px] flex-1 rounded-full", r.stage >= 1 ? "bg-status-due" : "bg-muted")} />
                <span className={cn("h-[5px] flex-1 rounded-full", r.stage >= 2 ? "bg-status-mastered" : "bg-muted")} />
              </span>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {mode === "due" ? "Explain each one, then grade yourself." : "Pick the definition, then explain it yourself."}
          </span>
          {bookHref && (
            <Link href={bookHref} className="text-meta text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Reread {title} in the book
            </Link>
          )}
        </aside>
      </div>
    </div>
  )
}
