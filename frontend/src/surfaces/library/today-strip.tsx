"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CalendarCheck2, ChevronRight } from "lucide-react"
import { fetchStudyDebt, type StudyDebt } from "@/gateways/api/progress"

/**
 * The review-debt banner on the Learn front door: whole-library due counts in one line,
 * pointing at the courses that need attention. Studying itself is chapter-scoped — open
 * a course and review from there (the cross-library session was retired 2026-07-15).
 */
export function TodayStrip() {
  const [debt, setDebt] = useState<StudyDebt | null>(null)

  const load = useCallback(() => {
    fetchStudyDebt()
      .then((d) => setDebt(d.error ? null : d))
      .catch(() => setDebt(null))
  }, [])

  useEffect(() => load(), [load])

  // Nothing tracked yet (fresh install / no study history): stay out of the way.
  if (!debt || debt.tracked === 0) return null

  const due = debt.dueNow
  const caughtUp = due === 0
  const topCourses = debt.courses.filter((c) => c.dueNow > 0).slice(0, 3)
  // Raw document titles can be whole filenames ("Title -- Author -- year -- isbn…"); keep the
  // part before the first separator so the strip stays one line.
  const shortTitle = (t: string) => t.split(/\s+--\s+|[:–—]/)[0].trim().slice(0, 40)

  return (
    <>
      {/* The whole strip is the way INTO the planner — the calendar itself stays on /study
          (user fork 2026-07-26: no duplicate calendar on the shelf). */}
      <Link
        href="/study"
        aria-label="Open the study planner"
        className={`group flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
          caughtUp
            ? "border-border/60 bg-card/40 hover:border-border hover:bg-card/70"
            : "border-brand/30 bg-brand/5 hover:border-brand/60 hover:bg-brand/10"
        }`}
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            caughtUp ? "bg-muted" : "bg-brand/15"
          }`}
        >
          <CalendarCheck2
            className={`h-4 w-4 ${caughtUp ? "text-muted-foreground" : "text-brand"}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {caughtUp ? (
              "Caught up — nothing due across your library."
            ) : (
              <>
                <span className="text-brand">{due}</span> to review today
                {topCourses.length > 0 && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {topCourses.map((c) => `${shortTitle(c.title)} (${c.dueNow})`).join(" · ")}
                  </span>
                )}
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {debt.fadingSoon > 0
              ? `${debt.fadingSoon} more fade within ${debt.days} days — a few minutes keeps them fresh.`
              : "Sessions also introduce a few new concepts each day."}
          </p>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1 text-xs font-medium ${
            caughtUp
              ? "text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              : "text-brand"
          }`}
        >
          Open planner
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>

    </>
  )
}
