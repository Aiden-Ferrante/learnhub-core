/** Deterministic per-book identity derived from the title, so every course is recognizable
 *  at a glance without real cover art. The shelf shows only the monogram (colour is a
 *  signal in the fleet, not decoration). */

/** Up to two initials from the title's significant words ("AI Engineering" → "AE"). */
export function coverMonogram(title: string): string {
  const SKIP = new Set(["a", "an", "the", "of", "and", "to", "in", "for", "with", "on"])
  const words = title.split(/[^A-Za-z0-9À-ɏ]+/).filter((w) => w && !SKIP.has(w.toLowerCase()))
  const pick = words.length ? words : title.split(/\s+/)
  return pick
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

/** Each course's own colour (v0.31.0), picked from the title so it never changes. Six muted
 *  hues (softened in v0.31.1 to sit on the neutral black), none of them the green, amber or rose that mean memory state, and none the
 *  terracotta that means "act here". Used on the shelf cover, the Up next steps and the Desk. */
export const COURSE_COLORS = ["#7F9CC0", "#9A8FC0", "#77A8A2", "#7FAFC2", "#B08AAE", "#8C92C9"] as const

export function coverColor(title: string): string {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  return COURSE_COLORS[h % COURSE_COLORS.length]
}
