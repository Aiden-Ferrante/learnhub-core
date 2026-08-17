"use client"

import { useRouter } from "next/navigation"
import { StudyPlanner } from "@/surfaces/studying"
import { useDocuments } from "@/surfaces/processing"

export default function StudyPage() {
  const router = useRouter()
  const { documents } = useDocuments()

  // The planner's calendar keys courses by the learn-doc-key, but the
  // /courses/[courseId] route wants the app-document-id (see frontend
  // ARCHITECTURE.md "Identifiers"). Resolve before navigating; fall back to
  // the raw key for legacy rows where the two ids coincide.
  const openCourse = (doc: string) => {
    const match = documents.find((d) => (d.learnDocId ?? d.id) === doc)
    router.push(`/courses/${match?.id ?? doc}`)
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-6 pt-6">
      <StudyPlanner onOpenCourse={openCourse} />
    </main>
  )
}
