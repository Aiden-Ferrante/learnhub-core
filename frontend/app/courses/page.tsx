"use client"

import { useRouter } from "next/navigation"
import { CourseShelf } from "@/features/learn/components/home/course-shelf"
import { chapterHref } from "@/features/learn/lib/scope-url"

export default function CoursesPage() {
  const router = useRouter()
  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <CourseShelf
        liveTree={[]}
        liveMastery={null}
        liveLoading={false}
        liveCourseId={null}
        onSelect={(course) => router.push(`/courses/${course.id}`)}
        onContinue={(course, sectionKey) => router.push(chapterHref(course.id, sectionKey))}
        onReview={(course) => router.push(chapterHref(course.id, null, { drawer: "review", all: true }))}
        onNewCourse={() => router.push("/upload")}
        onProcess={() => router.push("/process")}
      />
    </main>
  )
}
