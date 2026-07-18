/** Studying — the learning loop on screen: the review queue, the chapter walk, the planner.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  The loop has exactly two graded activities — skeleton recall (chapter walk) and
 *  concept recall (review panel) — both FSRS-scheduled. Owns those panels (also
 *  embedded by reading's study drawer), the grade scale, and study hotkeys.
 *  Depends on: concepts (display primitives), library (cover hue), gateways/, kit/. */

export { StudyPlanner } from "@/surfaces/studying/study-planner"
export { ChapterWalk } from "@/surfaces/studying/chapter-walk"
export { LessonPanel } from "@/surfaces/studying/lesson-panel"
export { LockInPanel } from "@/surfaces/studying/lockin-panel"
export { ReviewPanel } from "@/surfaces/studying/review-panel"
export { GRADES } from "@/surfaces/studying/grade-scale"
export { useStudyHotkeys } from "@/surfaces/studying/use-study-hotkeys"
