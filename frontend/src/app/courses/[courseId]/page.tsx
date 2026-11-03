"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { CourseFallback, CourseHome, useCourseData } from "@/surfaces/library"
import { chapterHref } from "@/kit/lib/scope-url"
import { StudyPage } from "@/kit/study"

export default function CourseHomePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
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
      <CourseHome
        course={data.course}
        data={data}
        onOpenSection={(scope) => {
          data.persistReadingPosition(scope)
          router.push(chapterHref(courseId, scope))
        }}
        onOpenConcept={(conceptKey) =>
          router.push(`/courses/${courseId}/concepts?concept=${encodeURIComponent(conceptKey)}`)
        }
      />
    </StudyPage>
  )
}
