import { cn } from "@/kit/lib/utils"

/** Thin horizontal meter. Brand fill by default; passing `warnAbove` turns the fill
 *  amber once pct crosses it (memory pressure, quota-style meters). */
export function MeterBar({
  pct,
  warnAbove,
  className,
}: {
  pct: number
  warnAbove?: number
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  const warned = warnAbove !== undefined && clamped > warnAbove
  return (
    <span
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted", className)}
    >
      <span
        className={cn(
          "block h-full rounded-full transition-all",
          warned ? "bg-status-due" : "bg-brand",
        )}
        style={{ width: `${clamped}%` }}
      />
    </span>
  )
}
