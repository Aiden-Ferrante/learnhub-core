"use client"

/** /courses/[id]/chapters/[chapterKey]/path — TRIAL (v0.31.5): the chapter as a guided path. */

import { use } from "react"
import { ChapterPath, CourseFallback, useCourseData } from "@/surfaces/library"
import { StudyPage } from "@/kit/study"

export default function ChapterPathPage({
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
    <StudyPage wide>
      <ChapterPath data={data} chapterKey={decodeURIComponent(chapterKey)} />
    </StudyPage>
  )
}
