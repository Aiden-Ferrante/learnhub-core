"use client"

/** /courses/[id]/chapters/[chapterKey] — TRIAL (v0.31.4): one chapter's own dashboard. */

import { use } from "react"
import { ChapterDashboard, CourseFallback, useCourseData } from "@/surfaces/library"
import { StudyPage } from "@/kit/study"

export default function ChapterDashboardPage({
  params,
}: {
  params: Promise<{ courseId: string; chapterKey: string }>
}) {
  const { courseId, chapterKey } = use(params)
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
      <ChapterDashboard data={data} chapterKey={decodeURIComponent(chapterKey)} />
    </StudyPage>
  )
}
