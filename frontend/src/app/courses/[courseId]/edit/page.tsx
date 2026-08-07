"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { CourseFallback, useCourseData } from "@/surfaces/library"
import { MaterialEditor } from "@/surfaces/authoring"
import { cleanCourseTitle } from "@/kit/lib/course-title"

export default function EditMaterialPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <MaterialEditor
        courseTitle={cleanCourseTitle(data.course.title).title}
        // Edits target the version you are actually in — docKey, not the card's id.
        versionName={data.activeVersion?.name ?? "Default"}
        docId={data.docKey ?? data.course.id}
        tree={data.tree}
        loading={data.loading}
        onBack={() => router.push(`/courses/${courseId}`)}
      />
    </main>
  )
}
