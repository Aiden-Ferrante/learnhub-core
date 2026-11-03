"use client"

/** /study — Plan: the review calendar, the agenda and recent sessions, on the study theme. */

import { useRouter } from "next/navigation"
import { StudyPlanner } from "@/surfaces/studying"
import { useDocuments } from "@/surfaces/processing"
import { StudyPage } from "@/kit/study"

export default function StudyPlanPage() {
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
    <StudyPage>
      <StudyPlanner onOpenCourse={openCourse} />
    </StudyPage>
  )
}
