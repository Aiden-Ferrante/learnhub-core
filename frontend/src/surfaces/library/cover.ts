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
