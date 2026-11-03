"use client"

import { useMemo } from "react"
import { Skeleton } from "@/kit/ui/skeleton"
import { fetchActivity, type ActivityDay } from "@/gateways/api/progress"
import { AsyncView, qk, useApi, orThrow } from "@/kit/data"
import { cn } from "@/kit/lib/utils"
import { Sheet } from "@/kit/study"

const WEEKS = 53
const DAY_MS = 86_400_000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
/** Level → cell fill: the accent at rising strength, muted for no activity. */
const LEVEL_FILL = ["bg-muted", "bg-brand/30", "bg-brand/50", "bg-brand/70", "bg-brand"]

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

function useGrid(days: ActivityDay[]) {
  return useMemo(() => {
    const counts = new Map<string, number>()
    let max = 0
    let total = 0
    for (const d of days) {
      counts.set(d.date, d.count)
      total += d.count
      if (d.count > max) max = d.count
    }
    const end = utcMidnight(new Date())
    const endDow = new Date(end).getUTCDay() // 0 = Sun
    const gridEnd = end + (6 - endDow) * DAY_MS // Saturday of the current week
    const gridStart = gridEnd - (WEEKS * 7 - 1) * DAY_MS // a Sunday

    const weeks: Cell[][] = []
    for (let w = 0; w < WEEKS; w++) {
      const col: Cell[] = []
      for (let d = 0; d < 7; d++) {
        const ms = gridStart + (w * 7 + d) * DAY_MS
        const key = isoDay(ms)
        col.push({ ms, key, count: counts.get(key) ?? 0, future: ms > end })
      }
      weeks.push(col)
    }
    // Month label above a column when its first day starts a new month.
    const monthAt = new Map<number, string>()
    let prev = -1
    weeks.forEach((col, i) => {
      const m = new Date(col[0].ms).getUTCMonth()
      if (m !== prev) {
        monthAt.set(i, MONTHS[m])
        prev = m
      }
    })
    return { weeks, total, max, monthAt }
  }, [days])
}

function Grid({ days }: { days: ActivityDay[] }) {
  const { weeks, max, monthAt } = useGrid(days)
  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-1.5">
        {/* pl-8 = the weekday gutter's w-7 + mr-1 below, so labels sit on their columns. */}
        <div className="flex gap-[3px] pl-8 text-micro text-muted-foreground">
          {weeks.map((_, i) => (
            <div key={i} className="w-2.5">
              {monthAt.has(i) ? <span className="-ml-px block">{monthAt.get(i)}</span> : null}
            </div>
          ))}
        </div>
        <div className="flex gap-[3px]">
          <div className="mr-1 flex w-7 shrink-0 flex-col gap-[3px] text-micro text-muted-foreground">
            {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
              <div key={i} className="flex h-2.5 items-center leading-none">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((col, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {col.map((cell) => (
                <div
                  key={cell.key}
                  className={cn("h-2.5 w-2.5 rounded-[2px]", cell.future ? "invisible" : LEVEL_FILL[levelFor(cell.count, max)])}
                  title={cell.future ? undefined : `${cell.count} activit${cell.count === 1 ? "y" : "ies"} · ${cell.key}`}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1.5 pt-0.5 text-micro text-muted-foreground">
          <span>Less</span>
          {LEVEL_FILL.map((fill) => (
            <div key={fill} className={cn("h-2.5 w-2.5 rounded-[2px]", fill)} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  )
}

/** A year of study activity, one cell per day (the whole library when `doc` is omitted). */
export function StudyHeatmap({ doc }: { doc?: string }) {
  const q = useApi(qk.activity(doc), (signal) => fetchActivity(doc, signal).then(orThrow))
  const cadence = q.data?.cadence
  const total = q.data?.days.reduce((sum, d) => sum + d.count, 0)
  return (
    <Sheet
      title="Study activity"
      actions={
        q.data && (
          <span className="flex items-center gap-2 text-meta tabular-nums text-muted-foreground">
            {cadence && (
              <span className="text-ink-accent" title="Days with any study activity in the last week">
                {cadence.activeDays}/{cadence.windowDays} days this week
              </span>
            )}
            <span>
              {total} activit{total === 1 ? "y" : "ies"} this year
            </span>
          </span>
        )
      }
    >
      <AsyncView q={q} errorTitle="Couldn't load your study activity" skeleton={<Skeleton className="h-[104px] w-full" />}>
        {(d) => <Grid days={d.days} />}
      </AsyncView>
    </Sheet>
  )
}
