import { cn } from "@/lib/utils"

export type DomainStatus =
  | "mastered"
  | "ready"
  | "due"
  | "fading"
  | "building"
  | "error"
  | "neutral"

const TONES: Record<DomainStatus, { dot: string; text: string; bg: string }> = {
  mastered: { dot: "bg-status-mastered", text: "text-status-mastered", bg: "bg-status-mastered/10" },
  ready: { dot: "bg-status-ready", text: "text-status-ready", bg: "bg-status-ready/10" },
  due: { dot: "bg-status-due", text: "text-status-due", bg: "bg-status-due/10" },
  fading: { dot: "bg-status-fading", text: "text-status-fading", bg: "bg-status-fading/10" },
  building: { dot: "bg-status-building", text: "text-status-building", bg: "bg-status-building/10" },
  error: { dot: "bg-status-error", text: "text-status-error", bg: "bg-status-error/10" },
  neutral: { dot: "bg-muted-foreground/60", text: "text-muted-foreground", bg: "bg-muted/40" },
}

/** Dot + label in the domain status vocabulary. `pulse` for in-flight states. */
export function StatusPill({
  status,
  children,
  pulse = false,
  className,
}: {
  status: DomainStatus
  children: React.ReactNode
  pulse?: boolean
  className?: string
}) {
  const tone = TONES[status]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone.bg,
        tone.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot, pulse && "animate-pulse")} />
      {children}
    </span>
  )
}
