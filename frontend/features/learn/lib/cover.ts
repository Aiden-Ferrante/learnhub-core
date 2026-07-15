/** Deterministic per-book visual identity: a gradient + monogram derived from the title,
 *  so every course is recognizable at a glance without real cover art. Alpha-blended over
 *  the card surface so it reads correctly in both themes. */

export function coverHue(title: string): number {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  return h % 360
}

export function coverGradient(title: string): string {
  const h1 = coverHue(title)
  const h2 = (h1 + 45) % 360
  return `linear-gradient(135deg, hsl(${h1} 60% 50% / 0.28), hsl(${h2} 65% 45% / 0.08))`
}

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
