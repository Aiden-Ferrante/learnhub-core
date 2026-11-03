import { cn } from "@/kit/lib/utils"

/** THE meter on study screens (.study-track): a bar filled to `value` percent (0–100).
 *  Tone is picked from the value (below 50 low, below 80 mid, else ok) unless given.
 *  Replaces MeterBar, kit/ui/progress and hand-rolled `h-1.5 rounded-full bg-muted` tracks.
 *
 *  @example <Track value={72} label="Chapter 3 score" />
 */
export function Track({
  value,
  tone,
  label,
  className,
}: {
  value: number
  tone?: "ok" | "mid" | "low"
  /** Accessible name, e.g. "Retention". */
  label: string
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const t = tone ?? (pct < 50 ? "low" : pct < 80 ? "mid" : "ok")
  return (
    <div
      className={cn("study-track", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      {/* Width is dynamic geometry, the one sanctioned inline style. */}
      <i className={cn(t !== "ok" && t)} style={{ width: `${pct}%` }} />
    </div>
  )
}
