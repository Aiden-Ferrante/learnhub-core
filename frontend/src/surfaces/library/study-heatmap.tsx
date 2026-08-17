"use client"

import { useEffect, useMemo, useState } from "react"
import { Skeleton } from "@/kit/ui/skeleton"
import { fetchActivity, type ActivityDay, type ActivityResponse } from "@/gateways/api/progress"

const WEEKS = 53
const DAY_MS = 86_400_000
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]
const LEVEL_OPACITY: Record<number, number> = { 1: 0.28, 2: 0.5, 3: 0.72, 4: 1 }

/** UTC midnight (ms) for a given Date — keeps cell keys aligned with the
 *  backend, which buckets events by UTC date. */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

type Cell = { ms: number; key: string; count: number; future: boolean }

function levelFor(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  const r = count / max
  if (r <= 0.25) return 1
  if (r <= 0.5) return 2
  if (r <= 0.75) return 3
  return 4
}

function cellStyle(count: number, max: number): React.CSSProperties {
  const level = levelFor(count, max)
  if (level === 0) return { backgroundColor: "hsl(var(--muted))" }
  return { backgroundColor: `hsl(var(--brand) / ${LEVEL_OPACITY[level]})` }
}

export function StudyHeatmap({ doc }: { doc?: string }) {
  const [days, setDays] = useState<ActivityDay[] | null>(null)
  const [cadence, setCadence] = useState<ActivityResponse["cadence"]>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchActivity(doc)
      .then((r) => {
        if (!active) return
        if (r.error) setError(r.error)
        else {
          setDays(r.days)
          setCadence(r.cadence)
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load activity")
      })
    return () => {
      active = false
    }
  }, [doc])

  const { weeks, total, max, monthLabels } = useMemo(() => {
    const counts = new Map<string, number>()
    let maxCount = 0
    let sum = 0
    for (const d of days ?? []) {
      counts.set(d.date, d.count)
      sum += d.count
      if (d.count > maxCount) maxCount = d.count
    }

    const end = utcMidnight(new Date())
    const endDow = new Date(end).getUTCDay() // 0 = Sun
    const gridEnd = end + (6 - endDow) * DAY_MS // Saturday of the current week
    const gridStart = gridEnd - (WEEKS * 7 - 1) * DAY_MS // a Sunday

    const weekCols: Cell[][] = []
    for (let w = 0; w < WEEKS; w++) {
      const col: Cell[] = []
      for (let d = 0; d < 7; d++) {
        const ms = gridStart + (w * 7 + d) * DAY_MS
        const key = isoDay(ms)
        col.push({ ms, key, count: counts.get(key) ?? 0, future: ms > end })
      }
      weekCols.push(col)
    }

    // Month label above a column when its first day starts a new month.
    const labels: { col: number; text: string }[] = []
    let prevMonth = -1
    weekCols.forEach((col, i) => {
      const m = new Date(col[0].ms).getUTCMonth()
      if (m !== prevMonth) {
        labels.push({ col: i, text: MONTHS[m] })
        prevMonth = m
      }
    })

    return { weeks: weekCols, total: sum, max: maxCount, monthLabels: labels }
  }, [days])

  if (error) return null

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Study activity</span>
        <span className="flex items-center gap-2">
          {cadence && (
            <span
              className="rounded-full bg-brand/10 px-2 py-0.5 text-micro font-medium tabular-nums text-brand"
              title="Days with any study activity in the last week"
            >
              {cadence.activeDays}/{cadence.windowDays} days this week
            </span>
          )}
          {days && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {total} activit{total === 1 ? "y" : "ies"} this year
            </span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto p-3">
        {!days ? (
          <Skeleton className="h-[104px] w-full" />
        ) : (
          <div className="inline-flex flex-col gap-1.5">
            {/* Month labels */}
            <div className="flex gap-[3px] pl-6 text-micro text-muted-foreground">
              {weeks.map((_, i) => {
                const label = monthLabels.find((l) => l.col === i)
                return (
                  <div key={i} className="w-2.5">
                    {label ? <span className="block -ml-px">{label.text}</span> : null}
                  </div>
                )
              })}
            </div>

            <div className="flex gap-[3px]">
              {/* Weekday gutter */}
              <div className="mr-0.5 flex w-5 shrink-0 flex-col gap-[3px] text-micro text-muted-foreground">
                {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
                  <div key={i} className="flex h-2.5 items-center leading-none">
                    {d}
                  </div>
                ))}
              </div>

              {/* Week columns */}
              {weeks.map((col, i) => (
                <div key={i} className="flex flex-col gap-[3px]">
                  {col.map((cell) => (
                    <div
                      key={cell.key}
                      className="h-2.5 w-2.5 rounded-[2px]"
                      style={cell.future ? { visibility: "hidden" } : cellStyle(cell.count, max)}
                      title={
                        cell.future
                          ? undefined
                          : `${cell.count} activit${cell.count === 1 ? "y" : "ies"} · ${cell.key}`
                      }
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end gap-1.5 pt-0.5 text-micro text-muted-foreground">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((lvl) => (
                <div
                  key={lvl}
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={
                    lvl === 0
                      ? { backgroundColor: "hsl(var(--muted))" }
                      : { backgroundColor: `hsl(var(--brand) / ${LEVEL_OPACITY[lvl]})` }
                  }
                />
              ))}
              <span>More</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
