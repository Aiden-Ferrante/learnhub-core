"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { CourseFallback, useCourseData } from "@/surfaces/library"
import { PacksHome } from "@/surfaces/practicing"
import { cleanCourseTitle } from "@/kit/lib/course-title"

export default function PacksPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <PacksHome
      courseTitle={cleanCourseTitle(data.course.title).title}
      docId={data.docKey ?? data.course.id}
      tree={data.tree}
      onOpen={(key) => router.push(`/courses/${courseId}/packs/${key}`)}
    />
  )
}
