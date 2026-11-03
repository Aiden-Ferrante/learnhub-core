"use client"

/** /courses/[id]/review — the course-wide review: every due concept, skeleton and chapter
 *  card in this course (docs/ui-spec.md §2). A minimal placeholder over ReviewPanel with
 *  the whole-course scope ("course" → backend build_review_queue's course scope); the
 *  studying migration owns its final shape. */

import { use } from "react"
import { CourseFallback, useCourseData } from "@/surfaces/library"
import { ReviewPanel } from "@/surfaces/studying"
import { Sheet, StudyPage } from "@/kit/study"

export default function CourseReviewPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <StudyPage narrow>
      <Sheet title="Review" description={`Everything due in ${data.course.title}`}>
        <ReviewPanel scope="course" docId={data.course.learnDocId} />
      </Sheet>
    </StudyPage>
  )
}
