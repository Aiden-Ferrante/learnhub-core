"use client"

/** The course home (docs/ui-spec.md §3), top to bottom: the hero with ONE primary action,
 *  the five study tiles, the syllabus tree, then compact stats and the heatmap. Back is
 *  the breadcrumb (Library › Course); this screen has no back button of its own. */

import { ErrorNotice } from "@/kit/data"
import { CourseHero } from "@/surfaces/library/course-hero"
import { CourseOutline } from "@/surfaces/library/course-outline"
import { CourseStats } from "@/surfaces/library/course-stats"
import type { Course } from "@/surfaces/library/courses"
import { StudyTiles } from "@/surfaces/library/study-tiles"
import type { CourseData } from "@/surfaces/library/use-course-data"
import { useCourseHome } from "@/surfaces/library/use-course-home"

export function CourseHome({
  course,
  data,
  onOpenSection,
  onOpenConcept,
}: {
  course: Course
  data: CourseData
  /** Open a chapter (records it as the reading position). */
  onOpenSection: (scope: string) => void
  /** Open one concept's detail (a concept leaf in the outline). */
  onOpenConcept: (conceptKey: string) => void
}) {
  const home = useCourseHome(course, data)
  return (
    <>
      <CourseHero course={course} step={home.next.step} />
      <StudyTiles courseId={course.id} data={data} home={home} />
      {data.positionError && (
        <ErrorNotice compact title="Reading position not saved" error={data.positionError} />
      )}
      <CourseOutline
        course={course}
        data={data}
        pipeline={home.pipeline.data}
        onOpenSection={onOpenSection}
        onOpenConcept={onOpenConcept}
      />
      {data.isLive && <CourseStats course={course} data={data} home={home} onOpenSection={onOpenSection} />}
    </>
  )
}
