import { cn } from "@/lib/utils"

const SIZES = {
  /** Course card ring (was course-shelf's MiniRing). */
  sm: { box: "h-12 w-12", inset: "inset-[5px]", text: "text-xs" },
  /** Course home hero ring (was course-home's MasteryRing). */
  lg: { box: "h-20 w-20", inset: "inset-[6px]", text: "text-lg" },
} as const

/** Low-ink circular progress: brand arc over the muted track, percent in the middle.
 *  The one mastery ring — every surface renders this, so they can't drift. */
export function ProgressRing({
  pct,
  size = "lg",
  className,
}: {
  pct: number
  size?: keyof typeof SIZES
  className?: string
}) {
  const s = SIZES[size]
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div
      role="img"
      aria-label={`${clamped}% mastered`}
      className={cn("relative shrink-0 rounded-full", s.box, className)}
      style={{
        background: `conic-gradient(hsl(var(--brand)) ${clamped * 3.6}deg, hsl(var(--muted)) 0deg)`,
      }}
    >
      <div className={cn("absolute flex items-center justify-center rounded-full bg-card", s.inset)}>
        <span className={cn("font-semibold tabular-nums", s.text)}>{clamped}%</span>
      </div>
    </div>
  )
}
