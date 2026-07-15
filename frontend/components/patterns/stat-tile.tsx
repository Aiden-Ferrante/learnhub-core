import { cn } from "@/lib/utils"

/** One number with its label — the building block of every stat strip. */
export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: number | string
  /** Optional secondary line under the label (e.g. "3 this week"). */
  hint?: string
  className?: string
}) {
  return (
    <div className={cn("rounded-lg border bg-background/40 px-3 py-2", className)}>
      <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground/70">{hint}</div>}
    </div>
  )
}
