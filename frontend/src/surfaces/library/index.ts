/** Library — the shelf and the course home: pick a course, see where you stand.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  Owns the course model (courses/course-groups/cover), the shelf + course home
 *  screens, the syllabus tree, and the course data hooks.
 *  Depends on: processing (document list), reading (reading progress), concepts
 *  (mastery dot), gateways/, kit/. */

export { CourseFallback } from "@/surfaces/library/course-guard"
export { CourseHome } from "@/surfaces/library/course-home"
export { CourseShelf } from "@/surfaces/library/course-shelf"
export { StudyHeatmap } from "@/surfaces/library/study-heatmap"
export { SyllabusTree } from "@/surfaces/library/syllabus-tree"
export { useCourseChapters } from "@/surfaces/library/use-course-chapters"
export { useCourseData } from "@/surfaces/library/use-course-data"
export { coverHue } from "@/surfaces/library/cover"
export { type Course } from "@/surfaces/library/courses"
