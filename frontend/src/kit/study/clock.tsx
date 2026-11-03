import { cn } from "@/kit/lib/utils"

/** Seconds → "m:ss" (or "h:mm:ss" past an hour). Negative clamps to 0:00. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** The exam clock (.study-clock), mono digits on an accent wash; danger when `low`.
 *  Presentational: the parent ticks `seconds`.
 *
 *  @example <Clock seconds={left} low={left < 300} />
 */
export function Clock({ seconds, low = false, className }: { seconds: number; low?: boolean; className?: string }) {
  return (
    <div className={cn("study-clock text-meta", low && "low", className)} role="timer" aria-live="off">
      {formatClock(seconds)}
    </div>
  )
}
