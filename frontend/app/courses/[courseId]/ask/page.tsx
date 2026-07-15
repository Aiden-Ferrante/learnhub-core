"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { AskPanel } from "@/features/learn"
import { CourseFallback } from "@/features/learn"
import { useCourseData } from "@/features/learn"
import { chapterHref } from "@/features/learn"

export default function AskPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <AskPanel
        course={data.course}
        onBack={() => router.push(`/courses/${courseId}`)}
        onOpenSection={(scope) => router.push(chapterHref(courseId, scope))}
      />
    </main>
  )
}
