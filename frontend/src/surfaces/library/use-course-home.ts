"use client"

/** The course home's own reads on top of useCourseData: the concept list (for its count),
 *  the pipeline status (the progress strip and WHY an empty course is empty), and the
 *  next-step rule shared with the Library Today panel. */

import { fetchDocumentConcepts } from "@/gateways/api/concepts"
import { displaySectionTitle } from "@/gateways/api/outline"
import { fetchCourseStatus } from "@/gateways/api/pipeline"
import { qk, useApi, orThrow } from "@/kit/data"
import type { Course } from "@/surfaces/library/courses"
import type { CourseData } from "@/surfaces/library/use-course-data"
import { useNextStep } from "@/surfaces/library/use-next-step"

export function useCourseHome(course: Course, data: CourseData) {
  const doc = course.learnDocId
  const concepts = useApi(qk.concepts(doc), (signal) => fetchDocumentConcepts(doc, signal).then(orThrow), {
    enabled: !!doc,
  })
  const pipeline = useApi(qk.courseStatus(doc ?? ""), (signal) => fetchCourseStatus(doc as string, signal).then(orThrow), {
    enabled: !!doc,
  })
  const next = useNextStep({
    courseId: course.id,
    docId: doc,
    dueNow: data.reviewDue,
    continueSectionKey: data.continueSectionKey,
    continueTitle: data.continueNode ? displaySectionTitle(data.continueNode.label, data.continueNode.title) : null,
  })
  return { concepts, pipeline, next, conceptCount: concepts.data ? concepts.data.concepts.length : null }
}

export type CourseHomeData = ReturnType<typeof useCourseHome>
