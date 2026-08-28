"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { CourseFallback, useCourseData } from "@/surfaces/library"
import { PracticeSession } from "@/surfaces/practicing"
import { cleanCourseTitle } from "@/kit/lib/course-title"

export default function PracticePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <PracticeSession
        courseTitle={cleanCourseTitle(data.course.title).title}
        docId={data.docKey ?? data.course.id}
        tree={data.tree}
        loading={data.loading}
        onBack={() => router.push(`/courses/${courseId}`)}
        onAnswered={data.retry}
      />
    </main>
  )
}
