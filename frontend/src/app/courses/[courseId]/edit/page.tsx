"use client"

import { use } from "react"
import { CourseFallback, useCourseData } from "@/surfaces/library"
import { CourseEditor } from "@/surfaces/authoring"
import { cleanCourseTitle } from "@/kit/lib/course-title"

export default function EditMaterialPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="container mx-auto px-6 py-6">
      <CourseEditor
        courseTitle={cleanCourseTitle(data.course.title).title}
        versionName={data.activeVersion?.name ?? "Default"}
        isDefault={(data.activeVersion?.origin ?? "default") === "default"}
        // Edits target the version you are actually in — docKey, not the card's id.
        docId={data.docKey ?? data.course.id}
        onChanged={data.retry}
      />
    </main>
  )
}
