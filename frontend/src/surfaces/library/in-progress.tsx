"use client"

/** "In progress" (v0.31.5 trial, 2026-11-19): the courses you are studying, big and first,
 *  each with its one next action. Replaces the Library's Today strip; the rest of the shelf
 *  sits below as a quieter grid. A course is in progress when it has cards due, a studied
 *  share, a saved reading place or an active exam-pack step. */

import Link from "next/link"
import { Button } from "@/kit/ui/button"
import { CourseCover } from "@/surfaces/library/course-card"
import { coverColor } from "@/surfaces/library/cover"
import type { Course } from "@/surfaces/library/courses"
import { useUpNext, type UpNextStep } from "@/surfaces/library/up-next"

export type InProgressItem = { course: Course; studied: number; due: number; step: UpNextStep | null }

function actionLabel(s: UpNextStep): string {
  if (s.kind === "review") return `Review ${s.due}`
  if (s.kind === "pack") return "Continue exam"
  return "Continue reading"
}

/** Which courses are in progress, most urgent first: due cards, then exam steps, then studied share. */
export function useInProgress(courses: Course[], studiedOf: (c: Course) => number, dueOf: (c: Course) => number) {
  const upNext = useUpNext()
  const first = new Map<string, UpNextStep>()
  for (const s of upNext.steps) if (!first.has(s.course.id)) first.set(s.course.id, s)
  const items: InProgressItem[] = courses
    .filter((c) => c.status === "ready")
    .map((c) => ({ course: c, studied: studiedOf(c), due: dueOf(c), step: first.get(c.id) ?? null }))
    .filter((i) => i.due > 0 || i.studied > 0 || i.step)
    .sort(
      (a, b) =>
        b.due - a.due ||
        Number(b.step?.kind === "pack") - Number(a.step?.kind === "pack") ||
        b.studied - a.studied ||
        a.course.title.localeCompare(b.course.title),
    )
  return { items, upNext }
}

export function InProgress({ items, upNext }: ReturnType<typeof useInProgress>) {
  const { probes, totalDue, steps } = upNext
  return (
    <section aria-label="In progress" className="flex flex-col gap-3">
      {probes}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-micro uppercase tracking-label text-muted-foreground">In progress</h2>
        <span className="text-meta text-muted-foreground">
          {items.length} {items.length === 1 ? "course" : "courses"}
          {totalDue > 0 && ` · ${totalDue} cards due`}
        </span>
        {steps.length > 0 && (
          <Link href="/session" className="ml-auto text-meta font-medium text-brand hover:underline">
            Start today’s session →
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-4 text-meta text-muted-foreground">
          Nothing in progress yet. Open a course below and start reading.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {items.map(({ course, studied, due, step }) => {
            const color = coverColor(course.title)
            return (
              <article
                key={course.id}
                className="group relative flex gap-4 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-foreground/30"
              >
                <div className="relative aspect-[3/4] w-[84px] shrink-0 overflow-hidden rounded-md border border-border bg-background shadow-sm">
                  <CourseCover course={course} small />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <h3 className="line-clamp-2 font-semibold leading-snug" title={course.title}>
                    <Link href={`/courses/${course.id}`} className="after:absolute after:inset-0">
                      {course.title}
                    </Link>
                  </h3>
                  <p className="text-meta tabular-nums text-muted-foreground">
                    {studied}% studied
                    {due > 0 && <span className="font-medium text-status-due"> · {due} due</span>}
                  </p>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full" style={{ width: `${studied}%`, background: color }} />
                  </div>
                  <div className="mt-auto flex items-center gap-2 pt-1.5">
                    <Button asChild size="sm" variant={step?.kind === "review" ? "default" : "outline"} className="relative z-10">
                      <Link href={step?.href ?? `/courses/${course.id}`} title={step?.kind === "pack" ? step.sub : undefined}>{step ? actionLabel(step) : "Open course"}</Link>
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
