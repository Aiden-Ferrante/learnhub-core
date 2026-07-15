"use client"

import { useRouter } from "next/navigation"
import { CourseShelf } from "@/features/learn/components/home/course-shelf"

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
        onNewCourse={() => router.push("/upload")}
        onProcess={() => router.push("/process")}
      />
    </main>
  )
}
