"use client"

/** The chapter page (v0.31.5): the chapter dashboard (Read / Review / Chapter exam) on top of
 *  the chapter as a guided path that ends at its exam. The human, 2026-11-19, after trying both:
 *  "the path layout looks good! I also like the chapter dashboard as it is" → dashboard row
 *  kept, the path replaced its Sections list, the separate /path page redirects here.
 *
 *  The human, 2026-11-19: "The exam should be the destination, we should break down a chapter
 *  into [steps] to make it easy to digest, and we want the reading to be guided and very clean.
 *  The reading is what leads to concept understanding which then leads to exams."
 *
 *  Steps are the chapter's reading sections, in order (2026-11-19: every section the reader
 *  reads is a step, concepts or not). A step with concepts is complete when understood
 *  (STEP_DONE of them studied), one without when read to the end. Exercises, solutions and
 *  notes are Extras. The exam closes the path and is always takeable; the path shows
 *  readiness, it does not lock. */

import Link from "next/link"
import { useMemo, useState } from "react"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { useReadSteps } from "@/kit/lib/read-steps"
import { chapterHref } from "@/kit/lib/scope-url"
import { cn } from "@/kit/lib/utils"
import {
  Badge,
  Bar,
  chaptersHref,
  contains,
  DemoControls,
  pct,
  plainTitle,
  useChapters,
  useDueByChapter,
} from "@/surfaces/library/chapter-cards"
import { coverColor } from "@/surfaces/library/cover"
import { PASS_MARK, useDemoExams } from "@/surfaces/library/demo-exams"
import { minutesOf, SectionDigest, useChapterDigest } from "@/surfaces/library/section-digest"
import type { CourseData } from "@/surfaces/library/use-course-data"

const STEP_DONE = 80

type Concept = { key?: string | null; name: string; kind?: string | null }

function conceptsOf(node: LearnTreeNode): Concept[] {
  const out: Concept[] = []
  const walk = (n: LearnTreeNode) => {
    out.push(...(n.concepts ?? []))
    n.children.forEach(walk)
  }
  walk(node)
  return out
}

const EXTRA = /^(exercises?|solutions?|answers?|problems?|notes|references|bibliography|further reading|projects?)\b/i

/** A chapter's steps: its reading sections, in order. Shared by the path and the step reader
 *  so both count the same steps. */
export function chapterSteps(chapter: LearnTreeNode): LearnTreeNode[] {
  return chapter.children.filter((s) => s.isSection && s.sectionKey && !EXTRA.test(plainTitle(s)))
}

export function chapterStepHref(courseId: string, chapterKey: string, index: number): string {
  return `/courses/${courseId}/chapters/${encodeURIComponent(chapterKey)}/step/${index + 1}`
}

/** Where the step reader goes back to: the chapter page (the path is part of it since 2026-11-19). */
export function chapterPathHref(courseId: string, chapterKey: string): string {
  return chaptersHref(courseId, chapterKey)
}

export function ChapterDashboard({ data, chapterKey }: { data: CourseData; chapterKey: string }) {
  const course = data.course!
  const color = coverColor(course.title)
  const { chapters, numbers } = useChapters(data.tree)
  const chapter = chapters.find((c) => c.sectionKey === chapterKey)
  const sections = useMemo(
    () => (chapter?.children ?? []).filter((s) => s.isSection && s.sectionKey),
    [chapter],
  )
  const due = useDueByChapter(course.learnDocId, sections)
  const exams = useDemoExams(course.id)
  const { read } = useReadSteps(course.learnDocId ?? undefined)
  const by = data.mastery?.bySection ?? {}
  const digest = useChapterDigest(course.learnDocId, chapter)
  // A step opens to its digest (in brief, concepts), never the reading; the current step
  // starts open. Reading is behind Read / "Start reading" only (human, 2026-11-19).
  const [opened, setOpened] = useState<Record<string, boolean>>({})

  if (!chapter) {
    return (
      <div className="flex flex-col gap-3">
        <Link href={chaptersHref(course.id)} className="text-meta text-muted-foreground hover:text-foreground">
          ← All chapters
        </Link>
        <p className="text-muted-foreground">{data.loading ? "Loading…" : "This chapter is not in the outline."}</p>
      </div>
    )
  }

  const steps = chapterSteps(chapter).map((node) => ({ node, concepts: conceptsOf(node) }))
  const extras = sections.filter((s) => EXTRA.test(plainTitle(s)))
  const understood = (s: LearnTreeNode) => pct(by[s.sectionKey!]) >= STEP_DONE
  const complete = (st: (typeof steps)[number]) =>
    st.concepts.length > 0 ? understood(st.node) : read.has(st.node.sectionKey!)
  const done = steps.filter(complete).length
  // The current step: where you are reading, unless that step is complete; otherwise the
  // first step not yet complete.
  const reading = data.continueSectionKey
    ? steps.find((s) => contains(s.node, data.continueSectionKey!) && !complete(s))
    : undefined
  const current = reading ?? steps.find((s) => !complete(s))
  const currentIndex = current ? steps.indexOf(current) : -1
  const hasExam = Boolean(numbers.get(chapter.id))
  const rec = exams.chapters[chapterKey]
  const wordsOf = (s: LearnTreeNode) => digest.bySection.get(s.sectionKey!)?.words ?? 0
  const totalWords = steps.reduce((a, s) => a + wordsOf(s.node), 0)
  const conceptCount = steps.reduce((a, x) => a + x.concepts.length, 0)
  const m = by[chapterKey]
  const n = due.get(chapterKey) ?? Array.from(due.values()).reduce((a, b) => a + b, 0)
  const ready = done === steps.length && steps.length > 0
  const card = "relative flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-sm"
  const label = "block text-[10px] uppercase tracking-widest text-muted-foreground"
  const action =
    "shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:border-muted-foreground/50"

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2.5">
        <Link href={chaptersHref(course.id)} className="text-meta text-muted-foreground hover:text-foreground">
          ← All chapters
        </Link>
        <div className="flex items-center gap-[18px]">
          {numbers.get(chapter.id) && (
            <span className="font-serif text-[40px] font-semibold leading-none" style={{ color }}>
              {numbers.get(chapter.id)}
            </span>
          )}
          <div>
            <h1 className="m-0 font-serif text-[26px] font-semibold leading-tight">{plainTitle(chapter)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {steps.length} steps
              {totalWords > 0 && ` · about ${minutesOf(totalWords)} min of reading`}
              {conceptCount > 0 && ` · ${conceptCount} concepts`}
              {m && m.total > 0 ? ` · ${pct(m)}% studied` : ""}
            </p>
          </div>
        </div>
        <div className="mt-1.5 flex max-w-[520px] items-center gap-3">
          <Bar value={steps.length ? (done / steps.length) * 100 : 0} color={color} className="h-[5px] flex-1" />
          <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
            {done} of {steps.length} steps
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className={card}>
          <div className="min-w-0 flex-1">
            <span className={label}>Read</span>
            <span className="block truncate font-semibold">
              {current
                ? `${reading ? "Continue" : currentIndex === 0 && done === 0 ? "Start" : "Next"} · Step ${currentIndex + 1}: ${plainTitle(current.node)}`
                : steps.length
                  ? "Every step read"
                  : "Nothing to read here"}
            </span>
            <Link
              href={chapterHref(course.id, chapterKey)}
              onClick={() => data.persistReadingPosition(chapterKey)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Whole chapter at once
            </Link>
          </div>
          {steps.length > 0 && (
            <Link
              href={chapterStepHref(course.id, chapterKey, Math.max(currentIndex, 0))}
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              {reading ? "Continue reading" : current ? "Start reading" : "Read again"}
            </Link>
          )}
        </div>
        <div className={card}>
          <Badge count={n} />
          <div className="min-w-0 flex-1">
            <span className={label}>Review</span>
            <span className="block truncate font-semibold">
              {n > 0 ? `${n} card${n === 1 ? "" : "s"} due` : "Nothing due in this chapter"}
            </span>
          </div>
          <Link href={chapterHref(course.id, chapterKey, { drawer: "review" })} className={action}>
            {n > 0 ? "Review now" : "Open review"}
          </Link>
        </div>
        <div
          id="exam"
          className={cn(card, "scroll-mt-28 border-2")}
          style={{ borderColor: rec?.passed ? "hsl(var(--status-mastered))" : color }}
        >
          <div className="min-w-0 flex-1">
            <span className={label}>Chapter exam ★</span>
            {hasExam ? (
              <>
                <span className="block truncate font-semibold">
                  {rec?.passed
                    ? `Passed · best ${rec.best}%`
                    : rec
                      ? `Last try ${rec.last}% · needs ${PASS_MARK}%`
                      : ready
                        ? "You're ready"
                        : `Pass ${PASS_MARK}% to complete this chapter`}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {done} of {steps.length} steps complete
                  {rec ? ` · ${rec.attempts} attempt${rec.attempts === 1 ? "" : "s"}` : ""}
                </span>
              </>
            ) : (
              <span className="block font-semibold text-muted-foreground">No exam for this part</span>
            )}
          </div>
          {hasExam && (
            <button
              type="button"
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold",
                rec?.passed || !ready ? "border border-border" : "bg-primary text-primary-foreground",
              )}
            >
              {rec?.passed ? "Retake" : rec ? "Retake exam" : "Take exam"}
            </button>
          )}
        </div>
      </div>
      {hasExam && (
        <div className="self-end text-xs [&>div]:mt-0 [&>div]:px-2 [&>div]:py-1">
          <DemoControls label="result" onScore={(score) => exams.sitChapter(chapterKey, score)} />
        </div>
      )}
      </div>

      <section className="flex flex-col gap-6">
        <div>
          <h2 className="m-0 font-serif text-[22px] font-semibold">Your path</h2>
          <p className="mt-1 text-meta text-muted-foreground">
            Read each step, check your understanding, then take the exam. Open a step for its key concepts.
          </p>
        </div>
          <ol className="m-0 flex list-none flex-col p-0">
            {steps.map((step, i) => {
              const s = step.node
              const isDone = complete(step)
              const isCurrent = current?.node === s
              const n = due.get(s.sectionKey!) ?? 0
              const share = pct(by[s.sectionKey!])
              const isOpen = opened[s.id] ?? isCurrent
              const words = wordsOf(s)
              const wasRead = read.has(s.sectionKey!)
              const status = isDone
                ? step.concepts.length > 0
                  ? "Understood"
                  : "Read"
                : wasRead
                  ? share > 0
                    ? `Read · ${share}% understood`
                    : "Read · check not taken"
                  : share > 0
                    ? `${share}% understood`
                    : null
              return (
                <li key={s.id} className="relative flex gap-5 pb-4">
                  {/* the path line to the next stop, coloured once this step is complete */}
                  <span
                    aria-hidden
                    className="absolute bottom-0 left-[17px] top-10 w-0.5 rounded-full"
                    style={{ background: isDone ? color : "hsl(var(--border))" }}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "relative z-10 mt-3 grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold tabular-nums",
                      !isDone && !isCurrent && "border-border bg-background text-muted-foreground",
                    )}
                    style={
                      isDone
                        ? { background: color, borderColor: color, color: "hsl(var(--background))" }
                        : isCurrent
                          ? { borderColor: color, color, background: "hsl(var(--background))", boxShadow: `0 0 0 4px ${color}22` }
                          : undefined
                    }
                  >
                    {isDone ? "✓" : i + 1}
                  </span>
                  <div
                    className={cn(
                      "min-w-0 flex-1 rounded-2xl border transition-colors",
                      isCurrent ? "bg-card" : isOpen ? "border-border bg-card" : "border-transparent hover:border-border hover:bg-card/50",
                    )}
                    style={isCurrent ? { borderColor: `${color}88` } : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => setOpened((o) => ({ ...o, [s.id]: !isOpen }))}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-4 px-5 py-4 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-widest" style={isCurrent ? { color } : undefined}>
                          <span className={cn(!isCurrent && "text-muted-foreground")}>
                            {isCurrent ? (reading ? "You are here" : "Up next") : `Step ${i + 1}`}
                          </span>
                        </span>
                        <span className={cn("mt-0.5 block font-serif text-[20px] font-semibold leading-snug", isDone && !isCurrent && "text-foreground/70")}>
                          {plainTitle(s)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1 text-meta text-muted-foreground">
                        <span className="tabular-nums">{words > 0 ? `${minutesOf(words)} min read` : ""}</span>
                        {status && <span className={cn(isDone && "text-ink-ok")}>{status}</span>}
                        {n > 0 && (
                          <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">
                            {n} to review
                          </span>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="flex flex-col gap-5 border-t border-border/60 px-5 pb-5 pt-4">
                        <SectionDigest digest={digest.bySection.get(s.sectionKey!)} loading={digest.loading} />
                        <div className="flex flex-wrap items-center gap-3">
                          <Link
                            href={chapterStepHref(course.id, chapterKey, i)}
                            className={cn(
                              "rounded-lg px-5 py-2.5 text-sm font-semibold",
                              isCurrent ? "bg-primary text-primary-foreground" : "border border-border hover:border-muted-foreground/50",
                            )}
                          >
                            {wasRead ? "Read again" : reading && isCurrent ? "Continue reading" : "Start reading"}
                          </Link>
                          {step.concepts.length > 0 && (
                            <Link
                              href={`${chapterStepHref(course.id, chapterKey, i)}#check`}
                              className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold hover:border-muted-foreground/50"
                            >
                              Check understanding
                            </Link>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}

            {/* the destination */}
            <li className="relative flex items-center gap-5 pt-2">
              <a href="#exam" className="absolute inset-0" aria-label="Go to the chapter exam" />
              <span
                aria-hidden
                className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-base"
                style={
                  rec?.passed
                    ? { background: "hsl(var(--status-mastered))", borderColor: "hsl(var(--status-mastered))", color: "hsl(var(--background))" }
                    : { borderColor: color, color, background: "hsl(var(--background))" }
                }
              >
                ★
              </span>
              <span className="font-serif text-[20px] font-semibold">Chapter exam</span>
              <span className="text-meta text-muted-foreground">
                {rec?.passed ? `passed · ${rec.best}%` : hasExam ? `pass ${PASS_MARK}% to complete the chapter` : "none for this part"}
              </span>
            </li>
          </ol>

          {extras.length > 0 && (
            <p className="pl-14 text-meta text-muted-foreground">
              Also in this chapter:{" "}
              {extras.map((x, i) => (
                <span key={x.id}>
                  {i > 0 && " · "}
                  <Link href={chapterHref(course.id, x.sectionKey!)} className="underline-offset-2 hover:text-foreground hover:underline">
                    {plainTitle(x)}
                  </Link>
                </span>
              ))}
            </p>
          )}
              </section>
    </div>
  )
}
