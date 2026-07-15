"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { PdfBookView } from "@/features/learn/components/reader/pdf-book-view"
import { CourseFallback } from "@/features/learn/components/course-guard"
import { useCourseData } from "@/features/learn/hooks/use-course-data"

export default function ReadPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <PdfBookView
        course={data.course}
        tree={data.tree}
        loading={data.loading}
        mastery={data.mastery}
        onBack={() => router.push(`/courses/${courseId}`)}
        onSectionRead={data.persistReadingPosition}
      />
    </main>
  )
}
