"use client"

/** Up next (v0.31.0): one ordered session across every course. Reviews come first (most due
 *  first), then each course's active exam-pack step, then up to three places to continue
 *  reading. The Library's Today strip shows the same steps in short, and its button opens
 *  the full list at /session. */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/kit/ui/button"
import { chapterHref } from "@/kit/lib/scope-url"
import { cn } from "@/kit/lib/utils"
import { coverColor } from "@/surfaces/library/cover"
import { courseFromDocument, type Course } from "@/surfaces/library/courses"
import { usePacks, usePackToday, useReadingPositions, useStudyDebt } from "@/surfaces/library/use-library-queries"
import { useDocuments } from "@/surfaces/processing"

export type UpNextStep = {
  key: string
  kind: "review" | "pack" | "read"
  course: Course
  color: string
  label: string
  sub: string
  href: string
  minutes: number | null
  due: number
}

const MAX_READING = 3

/** Reads a course's active pack and reports its step for now (or null). Renders nothing. */
function PackProbe({ course, onStep }: { course: Course; onStep: (id: string, s: UpNextStep | null) => void }) {
  const packs = usePacks(course.learnDocId)
  const active = packs.data?.packs.find((p) => p.status === "ready") ?? null
  const today = usePackToday(active?.key, !!active)
  const now = today.data?.now ?? null
  useEffect(() => {
    if (!active || !now) return onStep(course.id, null)
    onStep(course.id, {
      key: `pack:${course.id}`,
      kind: "pack",
      course,
      color: coverColor(course.title),
      label: `Continue ${active.title}`,
      sub: now.title,
      href: `/courses/${course.id}/packs/${encodeURIComponent(active.key)}?tab=today`,
      minutes: now.minutes,
      due: 0,
    })
  }, [active, now, course, onStep])
  return null
}

/** Every step for tonight, plus the probes that must be rendered for the pack steps. */
export function useUpNext() {
  const { documents } = useDocuments()
  const courses = useMemo(
    () => documents.map(courseFromDocument).filter((c) => c.status === "ready" && c.learnDocId),
    [documents],
  )
  const debt = useStudyDebt()
  const positions = useReadingPositions()
  const [packSteps, setPackSteps] = useState<Record<string, UpNextStep | null>>({})
  const onStep = useCallback(
    (id: string, s: UpNextStep | null) =>
      setPackSteps((prev) => (prev[id]?.href === s?.href && prev[id]?.sub === s?.sub && id in prev ? prev : { ...prev, [id]: s })),
    [],
  )

  const steps = useMemo(() => {
    const byDoc = new Map(courses.map((c) => [c.learnDocId as string, c]))
    const reviews: UpNextStep[] = (debt.data?.courses ?? [])
      .filter((d) => d.dueNow > 0 && byDoc.has(d.doc))
      .sort((a, b) => b.dueNow - a.dueNow)
      .map((d) => {
        const c = byDoc.get(d.doc) as Course
        return {
          key: `review:${c.id}`,
          kind: "review",
          course: c,
          color: coverColor(c.title),
          label: `Review ${d.dueNow} ${d.dueNow === 1 ? "card" : "cards"}`,
          sub: c.title,
          href: `/courses/${c.id}/review`,
          minutes: null,
          due: d.dueNow,
        }
      })
    const packs = courses.map((c) => packSteps[c.id]).filter((s): s is UpNextStep => !!s)
    const reading: UpNextStep[] = courses
      .filter((c) => positions.data?.[c.id])
      .slice(0, MAX_READING)
      .map((c) => ({
        key: `read:${c.id}`,
        kind: "read",
        course: c,
        color: coverColor(c.title),
        label: "Continue reading",
        sub: c.title,
        href: chapterHref(c.id, positions.data?.[c.id] ?? null),
        minutes: null,
        due: 0,
      }))
    return [...reviews, ...packs, ...reading]
  }, [courses, debt.data, positions.data, packSteps])

  const probes = courses.map((c) => <PackProbe key={c.id} course={c} onStep={onStep} />)
  const loading = debt.status === "loading" || positions.status === "loading"
  const totalDue = steps.reduce((n, s) => n + s.due, 0)
  return { steps, probes, loading, error: debt.status === "error" ? debt.error : null, totalDue }
}

/** The Library's Today strip: what is due, each in its course's colour, and one button. */
export function TodayStrip() {
  const { steps, probes, loading, totalDue } = useUpNext()
  const urgent = steps.filter((s) => s.kind !== "read")
  return (
    <section
      aria-label="Today"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-5 py-4"
    >
      {probes}
      <span className="text-micro uppercase tracking-label text-muted-foreground">Today</span>
      {loading ? (
        <span className="text-meta text-muted-foreground">Checking what is due…</span>
      ) : urgent.length === 0 ? (
        <span className="text-meta text-muted-foreground">Nothing due across your library.</span>
      ) : (
        urgent.map((s) => (
          <Link key={s.key} href={s.href} className="flex min-w-0 max-w-full items-center gap-2 text-meta hover:text-foreground">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="truncate">{s.kind === "review" ? `${s.due} due in ${s.course.title}` : s.label}</span>
          </Link>
        ))
      )}
      {steps.length > 0 && (
        <Button asChild size="sm" variant={totalDue > 0 ? "default" : "outline"} className="ml-auto">
          <Link href="/session">{totalDue > 0 ? `Review ${totalDue}` : "Up next"}</Link>
        </Button>
      )}
    </section>
  )
}

function partOfDay(d: Date): string {
  const day = d.toLocaleDateString(undefined, { weekday: "long" })
  const h = d.getHours()
  return `${day} ${h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"}`
}

/** The full session (/session): the steps in order, the first one marked, and one Start. */
export function UpNextPlan() {
  const { steps, probes, loading, error } = useUpNext()
  const [when, setWhen] = useState("")
  useEffect(() => setWhen(partOfDay(new Date())), [])
  const minutes = steps.reduce((n, s) => n + (s.minutes ?? 0), 0)
  const courseCount = new Set(steps.map((s) => s.course.id)).size

  return (
    <div className="flex flex-col gap-8 py-4">
      {probes}
      <div>
        <p className="mb-1.5 text-micro uppercase tracking-label text-muted-foreground">
          {when}
          {steps.length > 0 &&
            ` · ${steps.length} ${steps.length === 1 ? "step" : "steps"} across ${courseCount} ${courseCount === 1 ? "course" : "courses"}`}
          {minutes > 0 && ` · about ${minutes} min in packs`}
        </p>
        <h1 className="font-serif text-[2.5rem] font-semibold leading-tight">Up next</h1>
      </div>

      <section aria-label="Up next" className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6 sm:p-7">
        {loading ? (
          <p className="text-body text-muted-foreground">Working out tonight’s session…</p>
        ) : error ? (
          <p className="text-body text-ink-danger">Couldn’t read what is due. Try again in a moment.</p>
        ) : steps.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-body">Nothing due and nothing in progress. You’re caught up.</p>
            <Link href="/courses" className="text-meta text-muted-foreground underline underline-offset-4">
              Back to the Library
            </Link>
          </div>
        ) : (
          <>
            <ol className="flex flex-col">
              {steps.map((s, i) => (
                <li key={s.key} className={cn(i < steps.length - 1 && "border-b border-border")}>
                  <Link
                    href={s.href}
                    className="grid grid-cols-[4px_28px_1fr_auto] items-center gap-3.5 py-3.5 transition-colors hover:bg-muted/40 sm:gap-4"
                  >
                    <span aria-hidden className="h-9 w-1 rounded-sm" style={{ background: s.color }} />
                    <span
                      className={cn(
                        "grid h-7 w-7 place-items-center rounded-full text-meta font-semibold",
                        i === 0 ? "bg-primary text-primary-foreground" : "border border-muted-foreground/50 text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{s.label}</span>
                      <span className="block truncate text-meta text-muted-foreground">{s.sub}</span>
                    </span>
                    <span className="text-meta tabular-nums text-muted-foreground">
                      {s.minutes ? `${s.minutes} min` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href={steps[0].href}>Start session</Link>
              </Button>
              <span className="text-meta text-muted-foreground">Reviews first, then exam packs, then where you left off.</span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
