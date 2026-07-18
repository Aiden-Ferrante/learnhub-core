"use client"

import { useEffect, useMemo, useState } from "react"
import { AlarmClock, CalendarCheck2, History } from "lucide-react"
import { EmptyState } from "@/kit/patterns/empty-state"
import { PageHeader } from "@/kit/patterns/page-header"
import { SectionCard } from "@/kit/patterns/section-card"
import { StudyHeatmap } from "@/surfaces/library"
import { StatTile } from "@/kit/patterns/stat-tile"
import {
  fetchReviewCalendar,
  fetchSessions,
  type CalendarCourse,
  type CalendarDay,
  type ReviewCalendar,
  type SessionsResponse,
  type WorkingSession,
} from "@/gateways/api/planner"
import { coverHue } from "@/surfaces/library"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { cn } from "@/kit/lib/utils"

/** The /study planner: one cross-course surface for "when does what I studied come due"
 *  (review calendar over every scheduled item — concepts, structure, figures, chapter
 *  resurfaces) plus the derived working-session history that got you here. */

const HORIZON_DAYS = 60
const SESSION_DAYS = 30

// Static class lookups (Tailwind needs literal class names to keep them).
const LOAD_CLASSES = ["", "bg-brand/10", "bg-brand/25", "bg-brand/45", "bg-brand/70"]
const KIND_BADGES: Record<string, string> = {
  read: "bg-sky-500/15 text-sky-400",
  listen: "bg-sky-500/10 text-sky-500",
  review: "bg-emerald-500/15 text-emerald-400",
  recall: "bg-violet-500/15 text-violet-400",
  resurface: "bg-brand/15 text-brand",
}

const TYPE_LABELS: Record<string, string> = {
  concept: "concepts",
  skeleton: "structure",
  figure: "figures",
  chapter: "chapters",
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function courseDot(title: string): React.CSSProperties {
  return { backgroundColor: `hsl(${coverHue(title)} 60% 55%)` }
}

function CourseChips({ courses, onOpen }: { courses: CalendarCourse[]; onOpen: (doc: string) => void }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {courses.map((c) => (
        <li key={c.doc}>
          <button
            type="button"
            onClick={() => onOpen(c.doc)}
            className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/60"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={courseDot(c.title)} />
            <span className="min-w-0 flex-1 truncate group-hover:underline">
              {cleanCourseTitle(c.title).title}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {Object.entries(c.byType)
                .map(([t, n]) => `${n} ${TYPE_LABELS[t] || t}`)
                .join(" · ")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function CalendarGrid({
  calendar,
  selected,
  onSelect,
}: {
  calendar: ReviewCalendar
  selected: string | null
  onSelect: (date: string | null) => void
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarDay>()
    for (const d of calendar.days) m.set(d.date, d)
    return m
  }, [calendar.days])

  const today = utcDate(new Date())
  // Lay the horizon out as Monday-aligned weeks starting from this week.
  const cells = useMemo(() => {
    const start = new Date(`${today}T00:00:00Z`)
    const lead = (start.getUTCDay() + 6) % 7 // days since Monday
    start.setUTCDate(start.getUTCDate() - lead)
    const total = Math.ceil((lead + HORIZON_DAYS) / 7) * 7
    return Array.from({ length: total }, (_, i) => {
      const d = new Date(start)
      d.setUTCDate(start.getUTCDate() + i)
      return utcDate(d)
    })
  }, [today])

  const max = Math.max(1, ...calendar.days.map((d) => d.total))
  const load = (n: number) => LOAD_CLASSES[n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3))]

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date) => {
          const day = byDate.get(date)
          const count = day?.total ?? 0
          const isPast = date < today
          const isToday = date === today
          return (
            <button
              key={date}
              type="button"
              disabled={!day || isPast}
              onClick={() => onSelect(selected === date ? null : date)}
              title={count ? `${date} · ${count} due` : date}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-md border border-transparent text-xs",
                isPast ? "text-muted-foreground/40" : "text-foreground/90",
                !isPast && load(count),
                day && !isPast && "cursor-pointer hover:border-border",
                isToday && "border-brand/60",
                selected === date && "border-brand ring-1 ring-brand/50",
              )}
            >
              <span className={cn("leading-none", isToday && "font-semibold text-brand")}>
                {Number(date.slice(8, 10))}
              </span>
              {count > 0 && !isPast && (
                <span className="mt-0.5 text-[10px] font-medium leading-none tabular-nums">{count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SessionRow({ session }: { session: WorkingSession }) {
  const start = new Date(session.start * 1000)
  const when = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
  const duration = session.durationMin >= 1 ? `${Math.round(session.durationMin)} min` : "brief"
  return (
    <li className="flex items-start gap-2 rounded-md px-1.5 py-1.5">
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none",
          KIND_BADGES[session.kind] || "bg-muted text-muted-foreground",
        )}
      >
        {session.kind}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug">
        <span className="text-muted-foreground">{when}</span>
        <span className="mx-1.5 text-muted-foreground/50">·</span>
        {duration}
        {session.courses.length > 0 && (
          <span className="block truncate text-xs text-muted-foreground">
            {session.courses.map((c) => cleanCourseTitle(c.title).title).join(", ")}
          </span>
        )}
      </span>
      {session.graded > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {session.correct}/{session.graded}
        </span>
      )}
    </li>
  )
}

export function StudyPlanner({ onOpenCourse }: { onOpenCourse: (doc: string) => void }) {
  const [calendar, setCalendar] = useState<ReviewCalendar | null>(null)
  const [sessions, setSessions] = useState<SessionsResponse | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchReviewCalendar(HORIZON_DAYS), fetchSessions(SESSION_DAYS)])
      .then(([cal, ses]) => {
        if (cancelled) return
        setCalendar(cal)
        setSessions(ses)
        if (cal.error || ses.error) setError(cal.error || ses.error || null)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const fadingSoon = useMemo(
    () =>
      (calendar?.days ?? [])
        .filter((d) => d.date <= utcDate(new Date(Date.now() + 7 * 86400_000)))
        .reduce((n, d) => n + d.total, 0),
    [calendar],
  )
  const selectedDay = selected ? calendar?.days.find((d) => d.date === selected) : null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={<CalendarCheck2 className="h-4 w-4" />}
        title="Study planner"
        description="When what you've studied comes due — and the working sessions that got you here."
      />
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Due now" value={calendar?.dueNow.total ?? "—"} />
        <StatTile label="Due in 7 days" value={calendar ? fadingSoon : "—"} />
        <StatTile label={`Sessions · ${SESSION_DAYS}d`} value={sessions?.summary.count ?? "—"} />
        <StatTile
          label="Time studied"
          value={sessions?.summary.totalMinutes != null ? `${Math.round(sessions.summary.totalMinutes)}m` : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {calendar && calendar.dueNow.total > 0 && (
            <SectionCard
              title={
                <span className="flex items-center gap-2">
                  <AlarmClock className="h-4 w-4 text-status-due" /> Due now
                </span>
              }
              description={`${calendar.dueNow.total} items are past their review date — a short session brings them back.`}
            >
              <CourseChips courses={calendar.dueNow.courses} onOpen={onOpenCourse} />
            </SectionCard>
          )}

          <SectionCard
            title="Review calendar"
            description={`Everything scheduled over the next ${HORIZON_DAYS} days, all courses pooled. Click a day for the breakdown.`}
          >
            {calendar ? (
              <>
                <CalendarGrid calendar={calendar} selected={selected} onSelect={setSelected} />
                {selectedDay && (
                  <div className="mt-3 rounded-md border bg-muted/20 p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {new Date(`${selectedDay.date}T00:00:00Z`).toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        timeZone: "UTC", // days are bucketed in UTC — keep the label on the same clock
                      })}
                      {" · "}
                      {selectedDay.total} due
                    </p>
                    <CourseChips courses={selectedDay.courses} onOpen={onOpenCourse} />
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading calendar…</p>
            )}
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4">
        <StudyHeatmap />
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <History className="h-4 w-4" /> Recent sessions
            </span>
          }
          description="Derived from your study activity — reading, reviews, recall. No timers to run."
        >
          {sessions == null ? (
            <p className="text-sm text-muted-foreground">Loading sessions…</p>
          ) : sessions.sessions.length === 0 ? (
            <EmptyState title="No sessions yet" description="Read or review something and it shows up here." />
          ) : (
            <ul className="flex flex-col divide-y divide-border/40">
              {sessions.sessions.slice(0, 20).map((s) => (
                <SessionRow key={s.start} session={s} />
              ))}
            </ul>
          )}
        </SectionCard>
        </div>
      </div>
    </div>
  )
}
