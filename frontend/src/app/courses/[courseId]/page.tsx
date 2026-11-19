"use client"

/** /courses/[id] — the course as chapter hubs (v0.31.4): one card per chapter, the
 *  comprehensive exam, progress and activity. Each card opens /courses/[id]/chapters/[key]. */

import { use } from "react"
import { ChapterCards, CourseFallback, useCourseData } from "@/surfaces/library"
import { StudyPage } from "@/kit/study"

export default function CourseHomePage({ params }: { params: Promise<{ courseId: string }> }) {
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
    <StudyPage wide>
      <ChapterCards data={data} />
    </StudyPage>
  )
}
