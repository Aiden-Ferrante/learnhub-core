/** Learn — the study feature: course home/shelf, the reading surfaces, concepts,
 *  and the study panels.
 *
 *  This file is the feature's HUB (docs/frontend-org-audit.md): the only legal import
 *  surface from outside the feature, carrying exactly what app/ consumes. The 12
 *  modules under api/ are sanctioned sub-hubs (per-backend-domain facades) and are
 *  directly importable — the 2026-07-14 no-barrel decision stands for them.
 *  Depends on: documents (course shelf reads the document list), components/, lib/. */

export { ConceptsView } from "@/features/learn/components/concepts/concepts-view"
export { CourseFallback } from "@/features/learn/components/course-guard"
export { CourseHome } from "@/features/learn/components/home/course-home"
export { CourseShelf } from "@/features/learn/components/home/course-shelf"
export { SyllabusTree } from "@/features/learn/components/home/syllabus-tree"
export { ChapterReader } from "@/features/learn/components/reader/chapter-reader"
export { GuidedReading } from "@/features/learn/components/reader/guided-reading"
export { PdfBookView } from "@/features/learn/components/reader/pdf-book-view"
export { ReadingThemeToggle } from "@/features/learn/components/reader/reading-theme-toggle"
export { DrillView } from "@/features/learn/components/study/drill-view"
export { DumpView } from "@/features/learn/components/study/dump-view"
export { StudyPlanner } from "@/features/learn/components/study/study-planner"
export { useCourseChapters } from "@/features/learn/hooks/use-course-chapters"
export { useCourseData } from "@/features/learn/hooks/use-course-data"
export { chapterHref, scopeFromSegments, scopeToPath } from "@/features/learn/lib/scope-url"
export {
  chaptersFromOutline,
  numberKeyOf,
  outlineToTree,
  resolveChapterForScope,
  resolveChapterFromOutline,
  topLevelChapters,
  type CourseChapter,
} from "@/features/learn/lib/toc"
