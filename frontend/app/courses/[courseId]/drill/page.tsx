"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { DrillView } from "@/features/learn"
import { CourseFallback } from "@/features/learn"
import { useCourseData } from "@/features/learn"

export default function DrillPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <DrillView
        scope={null}
        docId={data.docKey!}
        onBack={() => router.push(`/courses/${courseId}`)}
        onDone={data.refresh}
      />
    </main>
  )
}
