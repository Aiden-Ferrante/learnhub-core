import { cn } from "@/kit/lib/utils"

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
      {/* Mono, because it is a machine fact — the fleet's Tile does the same.
          The label above it stays sans: a count is not prose, a caption is. */}
      <div className="font-mono text-section font-semibold leading-tight tabular-nums">{value}</div>
      <div className="text-micro uppercase tracking-tile text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-micro text-muted-foreground/70">{hint}</div>}
    </div>
  )
}
