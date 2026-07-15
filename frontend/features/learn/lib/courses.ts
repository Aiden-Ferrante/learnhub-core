/** Course model for the Learn hub shelf — one course per uploaded document. */

import type { Document } from "@/features/documents/document-context"

export type CourseStatus = "ready" | "processing" | "empty"

export type CourseFormat = "pdf" | "epub" | "html"

export type Course = {
  id: string
  title: string
  description: string
  status: CourseStatus
  format?: CourseFormat
  /** Learn-service document id (content namespace) for reader/markdown lookups. */
  learnDocId?: string
}

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
  const author = segs[1] && !META_SEG.test(segs[1]) ? segs[1].replace(/_ /g, ". ") : undefined
  return { title, author }
}

export function courseFromDocument(doc: Document): Course {
  const { title, author } = cleanCourseTitle(doc.name)
  return {
    id: doc.id,
    title,
    description: author
      ? `by ${author}`
      : doc.originalPdfName
        ? `Built from ${cleanCourseTitle(doc.originalPdfName).title}.`
        : `Built from ${title}.`,
    status:
      // The Learn hub reads learn-service content (PDF convert → concepts), keyed
      // by learnDocId — a course with one is ready regardless of the KG triple
      // pipeline's doc.status, which only the Upload/KG tabs care about. The
      // doc.status fallback covers legacy docs processed before learnDocId existed.
      doc.learnDocId || doc.status === "Processed"
        ? "ready"
        : doc.status === "Processing"
          ? "processing"
          : "empty",
    format: doc.convertedFromPdf ? "pdf" : undefined,
    learnDocId: doc.learnDocId,
  }
}

export function isCourseReady(course: Course): boolean {
  return course.status === "ready"
}
