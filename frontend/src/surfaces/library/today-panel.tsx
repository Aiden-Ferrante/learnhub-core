"use client"

/** The Library Today panel (docs/ui-spec.md §3): one line per course that has anything
 *  due, each with one button picked by the shared next-step rule; only the first is primary, and a Plan link
 *  at the right. Nothing else goes in the panel. */

import Link from "next/link"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice } from "@/kit/data"
import { SkeletonRow } from "@/kit/patterns/skeletons"
import { Sheet } from "@/kit/study"
import type { Course } from "@/surfaces/library/courses"
import { shortTitle } from "@/surfaces/library/short-title"
import { useStudyDebt } from "@/surfaces/library/use-library-queries"
import { useNextStep } from "@/surfaces/library/use-next-step"

function TodayLine({ course, dueNow }: { course: Course; dueNow: number }) {
  const { step, packs } = useNextStep({
    courseId: course.id,
    docId: course.learnDocId,
    dueNow,
    continueSectionKey: null,
  })
  // A course whose packs could not be read may still have a pack step: say so on its line
  // rather than dropping it as "nothing due".
  if (dueNow === 0 && packs.status === "error") {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 py-2">
        <span className="min-w-0 truncate text-body font-medium">{shortTitle(course.title)}</span>
        <ErrorNotice compact title="Couldn't load packs" error={packs.error} onRetry={packs.retry} />
      </li>
    )
  }
  // "Anything due" = reviews, or an active pack with a step for today. Reading alone is
  // not due, so a line whose rule lands on reading is not shown here.
  // While the rule is still deciding, hold a hidden placeholder so the list is not :empty
  // and the panel never claims "nothing due" before it knows.
  if (!step) return <li hidden />
  if (step.kind === "read") return null
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="min-w-0 truncate text-body font-medium">{shortTitle(course.title)}</span>
      {/* Outline by default; the first line's button is the one primary (globals.css .today-list). */}
      <Button asChild size="sm" variant="outline" className="today-cta">
        <Link href={step.href}>{step.label}</Link>
      </Button>
    </li>
  )
}

export function TodayPanel({ courses }: { courses: Course[] }) {
  const debt = useStudyDebt()
  const studyable = courses.filter((c) => c.status === "ready" && c.learnDocId)
  return (
    <Sheet
      title="Today"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/study">Plan</Link>
        </Button>
      }
    >
      <AsyncView q={debt} errorTitle="Couldn't load what's due" error="inline" skeleton={<SkeletonRow />}>
        {(d) => {
          const dueByDoc = new Map(d.courses.map((c) => [c.doc, c.dueNow]))
          return (
            <>
              {/* Lines render themselves (or nothing), so emptiness is read off the DOM:
                  an empty list shows the caught-up line beside it. */}
              <ul className="today-list peer divide-y divide-border">
                {studyable.map((c) => (
                  <TodayLine key={c.id} course={c} dueNow={dueByDoc.get(c.learnDocId as string) ?? 0} />
                ))}
              </ul>
              <p className="hidden text-meta text-muted-foreground peer-empty:block">
                Nothing due today across your library.
              </p>
            </>
          )
        }}
      </AsyncView>
    </Sheet>
  )
}
