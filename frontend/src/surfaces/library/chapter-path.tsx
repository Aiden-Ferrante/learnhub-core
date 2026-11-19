"use client"

/** TRIAL (v0.31.5): a chapter as a guided path that ends at its exam.
 *
 *  The human, 2026-11-19: "The exam should be the destination, we should break down a chapter
 *  into [steps] to make it easy to digest, and we want the reading to be guided and very clean.
 *  The reading is what leads to concept understanding which then leads to exams."
 *
 *  Steps are the chapter's sections that carry concepts; each is Read → Check understanding.
 *  A step is understood at STEP_DONE of its concepts studied. Only the current step is open.
 *  Sections without concepts (exercises, solutions, notes) are Extras. The exam closes the
 *  path and is always takeable; the path shows readiness, it does not lock. */

import Link from "next/link"
import { useMemo } from "react"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { chapterHref } from "@/kit/lib/scope-url"
import { cn } from "@/kit/lib/utils"
import {
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

export function chapterPathHref(courseId: string, chapterKey: string): string {
  return `/courses/${courseId}/chapters/${encodeURIComponent(chapterKey)}/path`
}

export function ChapterPath({ data, chapterKey }: { data: CourseData; chapterKey: string }) {
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
  const by = data.mastery?.bySection ?? {}

  if (!chapter) {
    return (
      <p className="text-muted-foreground">{data.loading ? "Loading…" : "This chapter is not in the outline."}</p>
    )
  }

  const steps = sections
    .map((s) => ({ node: s, concepts: conceptsOf(s) }))
    .filter((s) => s.concepts.length > 0)
  const extras = sections.filter((s) => conceptsOf(s).length === 0)
  const doneOf = (s: LearnTreeNode) => pct(by[s.sectionKey!]) >= STEP_DONE
  const done = steps.filter((s) => doneOf(s.node)).length
  // The current step: where you are reading, unless that step is already understood;
  // otherwise the first step not yet understood.
  const reading = data.continueSectionKey
    ? steps.find((s) => contains(s.node, data.continueSectionKey!) && !doneOf(s.node))
    : undefined
  const current = reading ?? steps.find((s) => !doneOf(s.node))
  const hasExam = Boolean(numbers.get(chapter.id))
  const rec = exams.chapters[chapterKey]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 text-meta text-muted-foreground">
          <Link href={chaptersHref(course.id)} className="hover:text-foreground">
            ← All chapters
          </Link>
          <span>
            Trial ·{" "}
            <Link href={chaptersHref(course.id, chapterKey)} className="underline underline-offset-2 hover:text-foreground">
              current hub
            </Link>
          </span>
        </div>
        <div className="flex items-baseline gap-4">
          {numbers.get(chapter.id) && (
            <span className="font-serif text-[48px] font-semibold leading-none" style={{ color }}>
              {numbers.get(chapter.id)}
            </span>
          )}
          <h1 className="m-0 font-serif text-[30px] font-semibold leading-tight">{plainTitle(chapter)}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Bar value={steps.length ? (done / steps.length) * 100 : 0} color={color} className="h-1.5 flex-1" />
          <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
            {done} of {steps.length} steps understood
          </span>
        </div>
      </div>

      <ol className="relative m-0 flex list-none flex-col p-0">
        {steps.map((step, i) => {
          const s = step.node
          const isDone = doneOf(s)
          const isCurrent = current?.node === s
          const n = due.get(s.sectionKey!) ?? 0
          const share = pct(by[s.sectionKey!])
          return (
            <li key={s.id} className="relative flex gap-4 pb-6 last:pb-0">
              {/* the path line */}
              <span aria-hidden className="absolute bottom-0 left-[15px] top-8 w-px bg-border" />
              <span
                aria-hidden
                className={cn(
                  "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-meta font-semibold tabular-nums",
                  isDone ? "border-transparent text-background" : isCurrent ? "bg-background" : "border-border bg-background text-muted-foreground",
                )}
                style={isDone ? { background: color } : isCurrent ? { borderColor: color, color } : undefined}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={chapterHref(course.id, s.sectionKey!)}
                    onClick={() => data.persistReadingPosition(s.sectionKey!)}
                    className={cn("font-semibold hover:text-primary", !isCurrent && !isDone && "text-muted-foreground")}
                  >
                    {plainTitle(s)}
                  </Link>
                  {n > 0 && (
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">
                      {n} to review
                    </span>
                  )}
                  {!isCurrent && (
                    <span className="text-meta text-muted-foreground">
                      {isDone ? "understood" : share > 0 ? `${share}%` : `${step.concepts.length} concepts`}
                    </span>
                  )}
                </div>
                {isCurrent && (
                  <div className="mt-3 flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                        You will learn · {step.concepts.length}
                      </p>
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {step.concepts.slice(0, 6).map((c) => c.name).join(" · ")}
                        {step.concepts.length > 6 && <span className="text-muted-foreground"> · +{step.concepts.length - 6} more</span>}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={chapterHref(course.id, s.sectionKey!)}
                        onClick={() => data.persistReadingPosition(s.sectionKey!)}
                        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                      >
                        {share > 0 || reading ? "Continue reading" : "Read this step"}
                      </Link>
                      <Link
                        href={chapterHref(course.id, s.sectionKey!, { drawer: "review" })}
                        className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold hover:border-muted-foreground/50"
                      >
                        Check understanding
                      </Link>
                      {share > 0 && <span className="text-meta tabular-nums text-muted-foreground">{share}% understood · done at {STEP_DONE}%</span>}
                    </div>
                  </div>
                )}
              </div>
            </li>
          )
        })}

        {/* the destination */}
        <li className="relative flex gap-4 pt-6">
          <span
            aria-hidden
            className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm"
            style={{ borderColor: color, color }}
          >
            ★
          </span>
          <div
            className="min-w-0 flex-1 rounded-xl border-2 bg-card p-5"
            style={{ borderColor: rec?.passed ? "hsl(var(--status-mastered))" : color }}
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Chapter exam</p>
            {hasExam ? (
              <>
                <p className="mt-1 font-serif text-xl font-semibold">
                  {rec?.passed ? `Passed · ${rec.best}%` : done === steps.length && steps.length > 0 ? "You're ready" : `Pass ${PASS_MARK}% to complete the chapter`}
                </p>
                <p className="mt-1 text-meta text-muted-foreground">
                  {done} of {steps.length} steps understood
                  {rec && !rec.passed ? ` · last try ${rec.last}%` : ""} · every retake has new questions
                </p>
                <button
                  type="button"
                  className={cn(
                    "mt-4 rounded-lg px-4 py-2.5 text-sm font-semibold",
                    rec?.passed || done < steps.length ? "border border-border" : "bg-primary text-primary-foreground",
                  )}
                >
                  {rec?.passed ? "Retake for practice" : rec ? "Retake exam" : "Take chapter exam"}
                </button>
                <DemoControls label="result" onScore={(score) => exams.sitChapter(chapterKey, score)} />
              </>
            ) : (
              <p className="mt-1 font-semibold text-muted-foreground">No exam for this part of the book</p>
            )}
          </div>
        </li>
      </ol>

      {extras.length > 0 && (
        <p className="text-meta text-muted-foreground">
          Extras:{" "}
          {extras.map((x, i) => (
            <span key={x.id}>
              {i > 0 && " · "}
              <Link href={chapterHref(course.id, x.sectionKey!)} className="hover:text-foreground">
                {plainTitle(x)}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
