/** Course model for the Learn hub shelf — one course per uploaded document. */

import type { Document } from "@/surfaces/processing"
import { cleanCourseTitle } from "@/kit/lib/course-title"

export type CourseStatus = "ready" | "converting" | "empty"

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
      // A converting card already carries its learnDocId (that's what makes the book
      // survive a lost tab), so this check comes FIRST — otherwise a book still being
      // converted would advertise itself as ready.
      doc.status === "Converting"
        ? "converting"
        : // The Learn hub reads learn-service content (PDF convert → concepts), keyed
          // by learnDocId — a course with one is ready regardless of the KG triple
          // pipeline's doc.status, which only the Upload/KG tabs care about. The
          // doc.status fallback covers legacy docs processed before learnDocId existed.
          doc.learnDocId || doc.status === "Processed"
          ? "ready"
          : "empty",
    format: doc.convertedFromPdf ? "pdf" : undefined,
    learnDocId: doc.learnDocId,
  }
}

export function isCourseReady(course: Course): boolean {
  return course.status === "ready"
}
