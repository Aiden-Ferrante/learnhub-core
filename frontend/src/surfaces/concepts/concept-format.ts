/** "toc:2-3-intro" → "2 3 intro": a section key a person can read, for when no heading is known. */
export function prettyScope(key?: string): string {
  if (!key) return ""
  return key.replace(/^toc:/, "").replace(/-/g, " ")
}
