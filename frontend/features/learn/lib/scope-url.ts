/** Section scope keys (e.g. "toc:1.2", and some contain slashes) ↔ URL path segments. */

export function scopeToPath(scope: string): string {
  return scope.split("/").map(encodeURIComponent).join("/")
}

export function scopeFromSegments(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null
  return segments.map(decodeURIComponent).join("/")
}

/** /courses/[id]/chapter/[scope?] with the drawer intent as query params. */
export function chapterHref(
  courseId: string,
  scope: string | null,
  opts?: { drawer?: string; all?: boolean },
): string {
  const base = `/courses/${courseId}/chapter${scope ? `/${scopeToPath(scope)}` : ""}`
  const params = new URLSearchParams()
  if (opts?.drawer) params.set("drawer", opts.drawer)
  if (opts?.all) params.set("all", "1")
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}
