import type { MemoryState } from "@/gateways/api/progress"

const STATE_CLASS: Record<MemoryState, string> = {
  new: "border border-muted-foreground/40",
  solid: "bg-brand",
  shaky: "bg-amber-400",
  fading: "bg-rose-400",
}

/** A small memory indicator (concept or section). Hollow = not reviewed; otherwise the
 *  retention state's color (solid / shaky / fading). */
export function ConceptMasteryDot({
  state = "new",
  retention,
  className,
}: {
  state?: MemoryState
  retention?: number | null
  className?: string
}) {
  const title =
    state === "new"
      ? "Not reviewed yet"
      : `Retention ${retention != null ? Math.round(retention * 100) : "—"}% · ${state}`
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${STATE_CLASS[state]} ${className ?? ""}`}
      title={title}
      aria-hidden
    />
  )
}
