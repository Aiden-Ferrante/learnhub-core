"use client"

import { useMemo } from "react"
import { Button } from "@/kit/ui/button"
import type { CalendarDay, ReviewCalendar } from "@/gateways/api/planner"
import { cn } from "@/kit/lib/utils"

/** How far ahead the Plan's calendar looks, in days. */
export const HORIZON_DAYS = 60

// Static class lookups (Tailwind needs literal class names to keep them).
const LOAD_CLASSES = ["", "bg-brand/10", "bg-brand/25", "bg-brand/45", "bg-brand/70"]

export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** The horizon as real calendar months (Monday-aligned, leading blanks), so a date sits
 *  where the eye expects it instead of in one continuous nine-week run. */
function monthBlocks(today: string, horizonDays: number) {
  const start = new Date(`${today}T00:00:00Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + horizonDays)
  const blocks: { key: string; label: string; leading: number; days: string[] }[] = []
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  while (cursor <= end) {
    const y = cursor.getUTCFullYear()
    const m = cursor.getUTCMonth()
    const first = new Date(Date.UTC(y, m, 1))
    const dayCount = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    blocks.push({
      key: `${y}-${m}`,
      label: first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }),
      leading: (first.getUTCDay() + 6) % 7, // Monday-aligned
      days: Array.from({ length: dayCount }, (_, i) => utcDate(new Date(Date.UTC(y, m, i + 1)))),
    })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return blocks
}

/** The review calendar: one cell per day, shaded by how much comes due. Click a day to
 *  filter the agenda to it; click it again to clear. */
export function CalendarGrid({
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
  const horizonEnd = useMemo(() => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + HORIZON_DAYS)
    return utcDate(d)
  }, [today])
  const months = useMemo(() => monthBlocks(today, HORIZON_DAYS), [today])

  const max = Math.max(1, ...calendar.days.map((d) => d.total))
  const load = (n: number) => LOAD_CLASSES[n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3))]

  return (
    <div className="flex flex-col gap-4">
      {months.map((month) => (
        <div key={month.key}>
          <p className="mb-1.5 text-xs font-medium text-foreground/80">{month.label}</p>
          <div className="grid grid-cols-7 gap-1 text-center text-micro uppercase tracking-label text-muted-foreground">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: month.leading }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {month.days.map((date) => {
              const day = byDate.get(date)
              const count = day?.total ?? 0
              // Outside [today, horizon] the grid is context, not a target.
              const outside = date < today || date > horizonEnd
              const isToday = date === today
              return (
                <Button
                  key={date}
                  type="button"
                  variant="ghost"
                  disabled={!day || outside}
                  aria-pressed={selected === date}
                  onClick={() => onSelect(selected === date ? null : date)}
                  title={count ? `${date} · ${count} due` : date}
                  className={cn(
                    "aspect-square h-auto flex-col gap-0 rounded-md border border-transparent p-0 text-xs font-normal disabled:opacity-100",
                    outside ? "text-muted-foreground/40" : "text-foreground/90",
                    !outside && load(count),
                    day && !outside && "hover:border-border",
                    isToday && "border-brand/60",
                    selected === date && "border-brand ring-1 ring-brand/50",
                  )}
                >
                  <span className={cn("leading-none", isToday && "font-semibold text-ink-accent")}>
                    {Number(date.slice(8, 10))}
                  </span>
                  {count > 0 && !outside && (
                    <span className="mt-0.5 text-micro font-medium leading-none tabular-nums">{count}</span>
                  )}
                </Button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
