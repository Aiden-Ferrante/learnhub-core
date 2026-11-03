"use client"

import { AlarmClock } from "lucide-react"
import { Button } from "@/kit/ui/button"
import type { CalendarCourse, CalendarItem, ReviewCalendar } from "@/gateways/api/planner"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { cn } from "@/kit/lib/utils"

const TYPE_LABELS: Record<string, string> = {
  concept: "concepts",
  skeleton: "structure",
  figure: "figures",
  chapter: "chapters",
}

// The wash carries the type; the word stays foreground (fills never colour words).
const ITEM_TYPE_BADGES: Record<string, string> = {
  concept: "bg-status-building/15",
  skeleton: "bg-brand/15",
  chapter: "bg-status-ready/15",
  figure: "bg-status-mastered/15",
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  concept: "concept",
  skeleton: "structure",
  figure: "figure",
  chapter: "chapter",
}

const ROW = "group h-auto w-full justify-start gap-2 whitespace-normal rounded-md px-1.5 py-1 text-left font-normal"

/** Due-now courses, one row each with its counts by type. Opens the course. */
export function CourseChips({ courses, onOpen }: { courses: CalendarCourse[]; onOpen: (doc: string) => void }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {courses.map((c) => (
        <li key={c.doc}>
          <Button type="button" variant="ghost" className={cn(ROW, "items-center text-sm")} onClick={() => onOpen(c.doc)}>
            <span className="min-w-0 flex-1 truncate group-hover:underline">{cleanCourseTitle(c.title).title}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {Object.entries(c.byType)
                .map(([t, n]) => `${n} ${TYPE_LABELS[t] || t}`)
                .join(" · ")}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

function AgendaItem({ item, onOpen }: { item: CalendarItem; onOpen: (doc: string) => void }) {
  return (
    <li>
      <Button type="button" variant="ghost" className={cn(ROW, "items-start")} onClick={() => onOpen(item.doc)}>
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-micro font-medium uppercase leading-none text-foreground",
            ITEM_TYPE_BADGES[item.type] || "bg-muted",
          )}
        >
          {ITEM_TYPE_LABELS[item.type] || item.type}
        </span>
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <span className="block truncate group-hover:underline">{item.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{cleanCourseTitle(item.title).title}</span>
        </span>
      </Button>
    </li>
  )
}

/** What's actually due, by name — overdue pinned first, then day by day. The grid
 *  answers "when"; this answers "what". */
export function ReviewAgenda({
  calendar,
  selected,
  onOpenCourse,
}: {
  calendar: ReviewCalendar
  selected: string | null
  onOpenCourse: (doc: string) => void
}) {
  const days = selected ? calendar.days.filter((d) => d.date === selected) : calendar.days
  const showOverdue = !selected && calendar.dueNow.total > 0

  if (!showOverdue && days.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {selected
          ? "Nothing due on this day."
          : calendar.tracked
            ? "Nothing scheduled in the horizon — you're all caught up."
            : "Nothing tracked yet. Study a chapter and its reviews land here."}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {showOverdue && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-label text-ink-warn">
            <AlarmClock className="h-3.5 w-3.5" /> Overdue · {calendar.dueNow.total}
          </p>
          <ul className="flex flex-col">
            {calendar.dueNow.items.map((item) => (
              <AgendaItem key={item.key} item={item} onOpen={onOpenCourse} />
            ))}
          </ul>
          {calendar.dueNow.itemsTruncated > 0 && (
            <p className="px-1.5 text-xs text-muted-foreground">+{calendar.dueNow.itemsTruncated} more overdue</p>
          )}
        </div>
      )}
      {days.map((day) => (
        <div key={day.date}>
          <p className="mb-1 text-xs font-medium uppercase tracking-label text-muted-foreground">
            {new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
            {" · "}
            {day.total}
          </p>
          <ul className="flex flex-col">
            {day.items.map((item) => (
              <AgendaItem key={item.key} item={item} onOpen={onOpenCourse} />
            ))}
          </ul>
          {day.itemsTruncated > 0 && <p className="px-1.5 text-xs text-muted-foreground">+{day.itemsTruncated} more</p>}
        </div>
      ))}
    </div>
  )
}
