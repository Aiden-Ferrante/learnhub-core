"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarCheck2, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ReviewPanel } from "@/components/learn/review-panel"
import { fetchStudyDebt, type StudyDebt } from "@/lib/learn-service"

/**
 * The one-tap daily drill entry on the Learn front door: whole-library review debt in one
 * line, one button into a mixed session (due concepts + due skeleton rebuilds across every
 * course, then the day's capped intake of new concepts). No course navigation required.
 */
export function TodayStrip() {
  const [debt, setDebt] = useState<StudyDebt | null>(null)
  const [open, setOpen] = useState(false)

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
      <div
        className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
          caughtUp ? "border-border/60 bg-card/40" : "border-nvidia-green/30 bg-nvidia-green/5"
        }`}
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            caughtUp ? "bg-muted" : "bg-nvidia-green/15"
          }`}
        >
          <CalendarCheck2
            className={`h-4 w-4 ${caughtUp ? "text-muted-foreground" : "text-nvidia-green"}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {caughtUp ? (
              "Caught up — nothing due across your library."
            ) : (
              <>
                <span className="text-nvidia-green">{due}</span> to review today
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
        <Button
          size="sm"
          variant={caughtUp ? "outline" : "default"}
          className="shrink-0 gap-1.5"
          onClick={() => setOpen(true)}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {caughtUp ? "Learn something new" : `Review ${due} now`}
        </Button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="flex h-[min(85vh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-medium">Today&rsquo;s session — all courses</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => {
                  setOpen(false)
                  load() // debt changed while grading
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <ReviewPanel scope={null} onAnswered={() => {}} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
