"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlarmClock, CalendarCheck2, History, Pencil, Plus, Trash2 } from "lucide-react"
import { EmptyState } from "@/kit/patterns/empty-state"
import { PageHeader } from "@/kit/patterns/page-header"
import { SectionCard } from "@/kit/patterns/section-card"
import { StudyHeatmap } from "@/surfaces/library"
import { StatTile } from "@/kit/patterns/stat-tile"
import { Button } from "@/kit/ui/button"
import { Input } from "@/kit/ui/input"
import { Label } from "@/kit/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/kit/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/kit/ui/select"
import {
  deleteManualSession,
  fetchReviewCalendar,
  fetchSessions,
  saveManualSession,
  type CalendarCourse,
  type CalendarDay,
  type ReviewCalendar,
  type SessionsResponse,
  type WorkingSession,
} from "@/gateways/api/planner"
import { coverHue } from "@/surfaces/library"
import { useDocuments } from "@/surfaces/processing"
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
  manual: "bg-amber-500/15 text-amber-400",
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

function SessionRow({
  session,
  onEdit,
  onDelete,
}: {
  session: WorkingSession
  /** Only manual blocks are editable — derived sessions are facts and get no affordance. */
  onEdit?: (s: WorkingSession) => void
  onDelete?: (s: WorkingSession) => void
}) {
  const start = new Date(session.start * 1000)
  const when = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
  const duration = session.durationMin >= 1 ? `${Math.round(session.durationMin)} min` : "brief"
  return (
    <li className="group/session flex items-start gap-2 rounded-md px-1.5 py-1.5">
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
        {session.note && (
          <span className="block truncate text-xs italic text-muted-foreground/80">{session.note}</span>
        )}
      </span>
      {session.graded > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {session.correct}/{session.graded}
        </span>
      )}
      {session.manual && onEdit && onDelete && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/session:opacity-100">
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Edit manual session"
            onClick={() => onEdit(session)}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-destructive"
            aria-label="Delete manual session"
            onClick={() => onDelete(session)}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      )}
    </li>
  )
}

// Local-time form helpers for the manual-session dialog.
const toLocalDate = (sec: number) => {
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const toLocalTime = (sec: number) => {
  const d = new Date(sec * 1000)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** Log/edit a manual study-time block: course, local date + start time, duration, note.
 *  Duration (not end time) keeps "end before start" unrepresentable in the form; the
 *  backend still validates. */
function ManualSessionDialog({
  open,
  editing,
  courses,
  onClose,
  onSaved,
}: {
  open: boolean
  editing: WorkingSession | null
  courses: { doc: string; title: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [doc, setDoc] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [minutes, setMinutes] = useState("30")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed the form each open: edit prefills from the block, add defaults to "the last
  // half hour, first course".
  useEffect(() => {
    if (!open) return
    setError(null)
    if (editing) {
      setDoc(editing.courses[0]?.doc ?? "")
      setDate(toLocalDate(editing.start))
      setTime(toLocalTime(editing.start))
      setMinutes(String(Math.max(1, Math.round(editing.durationMin))))
      setNote(editing.note ?? "")
    } else {
      const nowSec = Date.now() / 1000
      setDoc(courses[0]?.doc ?? "")
      setDate(toLocalDate(nowSec))
      setTime(toLocalTime(nowSec - 1800))
      setMinutes("30")
      setNote("")
    }
  }, [open, editing, courses])

  const save = async () => {
    const start = new Date(`${date}T${time}`).getTime() / 1000
    const mins = parseInt(minutes, 10)
    if (!doc || !Number.isFinite(start) || !Number.isFinite(mins) || mins <= 0) {
      setError("Pick a course, a valid start, and a positive duration.")
      return
    }
    setBusy(true)
    const res = await saveManualSession({
      doc,
      start,
      end: start + mins * 60,
      note: note.trim() || null,
      key: editing?.key,
    })
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit study time" : "Log study time"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Course</Label>
            <Select value={doc} onValueChange={setDoc}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a course" />
              </SelectTrigger>
              <SelectContent>
                {courses.map((c) => (
                  <SelectItem key={c.doc} value={c.doc}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-date">Date</Label>
              <Input id="ms-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-time">Start</Label>
              <Input id="ms-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-minutes">Duration (minutes)</Label>
            <Input
              id="ms-minutes"
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-note">Note (optional)</Label>
            <Input
              id="ms-note"
              value={note}
              placeholder="e.g. chapter 3 on paper"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {editing ? "Save changes" : "Log time"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  // Manual time blocks: courses to pick from (learn-doc-keyed), dialog state, refetch.
  const { documents } = useDocuments()
  const manualCourses = useMemo(
    () =>
      documents
        .filter((d) => d.learnDocId)
        .map((d) => ({ doc: d.learnDocId!, title: cleanCourseTitle(d.name).title })),
    [documents],
  )
  const [manualOpen, setManualOpen] = useState(false)
  const [manualEditing, setManualEditing] = useState<WorkingSession | null>(null)
  const reloadSessions = useCallback(() => {
    fetchSessions(SESSION_DAYS)
      .then((ses) => {
        setSessions(ses)
        if (ses.error) setError(ses.error)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  const handleDeleteManual = useCallback(
    (s: WorkingSession) => {
      if (!s.key) return
      deleteManualSession(s.key).then((res) => {
        if (res.error) setError(res.error)
        else reloadSessions()
      })
    },
    [reloadSessions],
  )

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
          actions={
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                setManualEditing(null)
                setManualOpen(true)
              }}
            >
              <Plus className="h-3 w-3" />
              Log time
            </Button>
          }
        >
          {sessions == null ? (
            <p className="text-sm text-muted-foreground">Loading sessions…</p>
          ) : sessions.sessions.length === 0 ? (
            <EmptyState title="No sessions yet" description="Read or review something — or log time manually — and it shows up here." />
          ) : (
            <ul className="flex flex-col divide-y divide-border/40">
              {sessions.sessions.slice(0, 20).map((s) => (
                <SessionRow
                  key={s.manual ? s.key : s.start}
                  session={s}
                  onEdit={(sess) => {
                    setManualEditing(sess)
                    setManualOpen(true)
                  }}
                  onDelete={handleDeleteManual}
                />
              ))}
            </ul>
          )}
        </SectionCard>
        </div>
      </div>

      <ManualSessionDialog
        open={manualOpen}
        editing={manualEditing}
        courses={manualCourses}
        onClose={() => setManualOpen(false)}
        onSaved={reloadSessions}
      />
    </div>
  )
}
