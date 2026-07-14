/** A small mastery indicator for a single concept. Hollow = not studied; otherwise a
 *  green dot whose opacity tracks mastery (mirrors the section MasteryDot in syllabus-tree). */
export function ConceptMasteryDot({
  mastery,
  attempts,
}: {
  mastery?: number
  attempts?: number
}) {
  if (!attempts || attempts === 0 || mastery === undefined) {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40"
        title="Not studied yet"
        aria-hidden
      />
    )
  }
  const m = Math.min(1, Math.max(0, mastery))
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full bg-brand"
      style={{ opacity: 0.2 + 0.8 * m }}
      title={`Mastery ${Math.round(m * 100)}%`}
    />
  )
}
