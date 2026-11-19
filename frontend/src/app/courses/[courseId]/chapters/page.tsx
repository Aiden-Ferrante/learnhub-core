"use client"

/** /courses/[id]/chapters — TRIAL (v0.31.4): the Overview as chapter cards only. */

import { use } from "react"
import { ChapterCards, CourseFallback, useCourseData } from "@/surfaces/library"
import { StudyPage } from "@/kit/study"

export default function ChapterCardsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const data = useCourseData(courseId)
  if (!data.course) {
    return (
      <StudyPage>
        <CourseFallback isInitialized={data.isInitialized} />
      </StudyPage>
    )
  }
  return (
    <StudyPage>
      <ChapterCards data={data} />
    </StudyPage>
  )
}
