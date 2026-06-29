/** Course model for the Learn hub shelf — one course per uploaded document. */

import type { Document } from "@/contexts/document-context"

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

export function courseFromDocument(doc: Document): Course {
  return {
    id: doc.id,
    title: doc.name.replace(/\.(txt|md|markdown)$/i, ""),
    description: doc.originalPdfName
      ? `Built from ${doc.originalPdfName}.`
      : `Built from ${doc.name}.`,
    status:
      doc.status === "Processed"
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
