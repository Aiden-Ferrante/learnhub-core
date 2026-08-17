"use client"

import { useRouter } from "next/navigation"
import { CourseShelf } from "@/surfaces/library"
import { chapterHref } from "@/kit/lib/scope-url"

export default function CoursesPage() {
  const router = useRouter()
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-6 pt-6">
      <CourseShelf
        liveTree={[]}
        liveMastery={null}
        liveLoading={false}
        liveCourseId={null}
        onSelect={(course) => router.push(`/courses/${course.id}`)}
        onContinue={(course, sectionKey) => router.push(chapterHref(course.id, sectionKey))}
        onNewCourse={() => router.push("/upload")}
        onProcess={() => router.push("/process")}
      />
    </main>
  )
}
