"use client"

/** /courses/[id]/review — the course-wide review: every due concept, skeleton and chapter
 *  card in this course (docs/ui-spec.md §2), run through the same ReviewPanel as the
 *  reading drawer with the whole-course scope. Its due count is the one the Library and
 *  nav badges show for this course, so working it down takes them to zero. The
 *  breadcrumbs (Library › Course › Review) are the way back. */

import { use } from "react"
import { CourseFallback, useCourseData } from "@/surfaces/library"
import { ReviewPanel } from "@/surfaces/studying"
import { StudyPage } from "@/kit/study"
import { PageHeader } from "@/kit/patterns/page-header"

export default function CourseReviewPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <StudyPage narrow>
      <PageHeader
        title="Review"
        description={`Everything due in ${data.course.title}: concepts, structure and chapters.`}
      />
      <ReviewPanel scope="course" docId={data.course.learnDocId} />
    </StudyPage>
  )
}
