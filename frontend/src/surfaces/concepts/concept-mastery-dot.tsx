/** A small mastery indicator (concept or section). Hollow = not studied; otherwise a
 *  brand dot whose opacity tracks mastery. `isRollup` marks a section-level rollup. */
export function ConceptMasteryDot({
  mastery,
  attempts,
  isRollup,
  className,
}: {
  mastery?: number
  attempts?: number
  isRollup?: boolean
  className?: string
}) {
  if (!attempts || attempts === 0 || mastery === undefined) {
    return (
      <span
        className={`h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40 ${className ?? ""}`}
        title="Not studied yet"
        aria-hidden
      />
    )
  }
  const m = Math.min(1, Math.max(0, mastery))
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full bg-brand ${className ?? ""}`}
      style={{ opacity: 0.2 + 0.8 * m }}
      title={`Mastery ${Math.round(m * 100)}%${isRollup ? " (rolled up)" : ""}`}
    />
  )
}
