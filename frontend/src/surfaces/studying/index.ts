/** Studying — the learning loop on screen: the review queue, the chapter walk, the planner.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  The loop has exactly two graded activities — skeleton recall (chapter walk) and
 *  concept recall (review panel) — both FSRS-scheduled. Owns those panels (also
 *  embedded by reading's study drawer), and study hotkeys (the grade scale is kit/study GradeButtons). Every read
 *  goes through kit/data's useApi and renders through AsyncView; every grade is a
 *  useApiMutation that advances only once saved ("Not saved · Retry" otherwise).
 *  Depends on: concepts (display primitives), library (heatmap), processing (documents),
 *  reading (figures), gateways/, kit/. */

export { StudyPlanner } from "@/surfaces/studying/study-planner"
export { ChapterWalk } from "@/surfaces/studying/chapter-walk"
export { SkeletonPractice } from "@/surfaces/studying/skeleton-practice"
export { LessonPanel } from "@/surfaces/studying/lesson-panel"
export { LockInPanel } from "@/surfaces/studying/lockin-panel"
export { ReviewPanel } from "@/surfaces/studying/review-panel"
export { useStudyHotkeys } from "@/surfaces/studying/use-study-hotkeys"
