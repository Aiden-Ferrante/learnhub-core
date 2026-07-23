// Second segment of an archive-style filename that is metadata, not the author.
const META_SEG =
  /^(?:\d{4}.*|isbn.*|[0-9a-f]{16,}|anna['’]?s archive.*|z-?lib.*|libgen.*|early release.*|o['’]?reilly.*|packt.*|manning.*|no starch.*|mit press.*|springer.*|wiley.*|pearson.*)$/i

/** Derive a human title (and author when present) from archive-style filenames like
 *  "Title _ Subtitle -- Author -- 2022 -- Publisher -- <hash> -- Anna's Archive.pdf".
 *  Plain names pass through untouched, so a user's manual rename always wins. */
export function cleanCourseTitle(raw: string): { title: string; author?: string } {
  const name = raw.replace(/\.(pdf|epub|txt|md|markdown|html?)$/i, "").trim()
  if (!name.includes(" -- ")) return { title: name }
  const segs = name.split(" -- ").map((s) => s.trim()).filter(Boolean)
  const title = (segs[0] || name).replace(/\s?_ /g, ": ") // "_" is a sanitized ":"
  // Some filenames carry the prefix in the segment itself ("-- by Luciano Ramalho --");
  // strip it here so display code can always prepend its own "by " without doubling.
  const author =
    segs[1] && !META_SEG.test(segs[1])
      ? segs[1].replace(/_ /g, ". ").replace(/^by\s+/i, "")
      : undefined
  return { title, author }
}
