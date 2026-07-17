"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { DumpView } from "@/surfaces/studying"
import { CourseFallback } from "@/surfaces/library"
import { useCourseData } from "@/surfaces/library"

export default function DumpPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <DumpView
        chapters={data.tree}
        docId={data.docKey!}
        onBack={() => router.push(`/courses/${courseId}`)}
        onDone={data.refresh}
      />
    </main>
  )
}
