"use client"

import Link from "next/link"
import { BookMarked, BookOpen, PencilLine, Sparkles } from "lucide-react"
import { findChapterForSection } from "@/gateways/api/outline"
import type { CoursePipelineStatus } from "@/gateways/api/pipeline"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice } from "@/kit/data"
import { EmptyState } from "@/kit/patterns/empty-state"
import { Sheet } from "@/kit/study"
import type { Course } from "@/surfaces/library/courses"
import { SyllabusTree } from "@/surfaces/library/syllabus-tree"
import type { CourseData } from "@/surfaces/library/use-course-data"
import { VersionMenu } from "@/surfaces/library/version-menu"

/** The empty outline says WHY it is empty: no learn content, a dead content link (the
 *  document was deleted or re-ingested), a PDF with no table of contents, or not built. */
function CourseEmpty({ course, pipeline }: { course: Course; pipeline: CoursePipelineStatus | undefined }) {
  const [title, description] = !course.learnDocId
    ? [
        "This course has no learn content",
        "The document was added without a finished PDF conversion, so there is nothing to read or study yet. Re-upload the PDF to build it.",
      ]
    : pipeline && !pipeline.exists
      ? [
          "Content link broken",
          "This course points at a document that no longer exists: it was likely deleted or replaced by a re-ingest. Re-upload the PDF to rebuild it (identical files are linked automatically).",
        ]
      : pipeline?.exists && (pipeline.outlineEntries ?? 0) === 0
        ? [
            "This PDF has no table of contents",
            "The reader still works, but a syllabus tree can't be built without PDF bookmarks. Concepts extracted per section are still available.",
          ]
        : [
            "No syllabus outline for this course",
            "It may still be processing, or this book has no numbered table of contents. If you've extracted concepts, view them directly.",
          ]
  return (
    <EmptyState
      icon={<BookMarked />}
      title={title}
      description={description}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={`/courses/${course.id}/concepts`}>
            <Sparkles />
            View concepts
          </Link>
        </Button>
      }
    />
  )
}

/** The syllabus tree in its sheet, with the book-level tools (the book itself, the
 *  version picker, the material editor) in the header. */
export function CourseOutline({
  course,
  data,
  pipeline,
  onOpenSection,
  onOpenConcept,
}: {
  course: Course
  data: CourseData
  pipeline: CoursePipelineStatus | undefined
  onOpenSection: (scope: string) => void
  onOpenConcept: (conceptKey: string) => void
}) {
  const base = `/courses/${course.id}`
  const versions = data.queries.versions
  return (
    <Sheet
      title="Course outline"
      description={data.sectionCount > 0 ? `${data.sectionCount} sections` : undefined}
      actions={
        <>
          <Button asChild variant="ghost" size="sm" className="h-8 px-2">
            <Link href={`${base}/read`}>
              <BookOpen />
              Read the book
            </Link>
          </Button>
          {data.bookKey && data.course && (
            <VersionMenu bookKey={data.bookKey} courseId={data.course.id} versions={data.versions} activeVersion={data.activeVersion} />
          )}
          <Button asChild variant="ghost" size="sm" className="h-8 px-2">
            <Link href={`${base}/edit`}>
              <PencilLine />
              Edit material
            </Link>
          </Button>
        </>
      }
    >
      {versions.error && (
        <ErrorNotice compact title="Couldn't load this book's courses" error={versions.error} onRetry={versions.retry} />
      )}
      {/* A course that isn't ready has no tree to load: say why straight away. */}
      {!data.isLive ? (
        <CourseEmpty course={course} pipeline={pipeline} />
      ) : (
        <AsyncView
          q={data.queries.tree}
          errorTitle="Couldn't load the syllabus"
          isEmpty={(d) => d.tree.length === 0}
          empty={<CourseEmpty course={course} pipeline={pipeline} />}
        >
          {(d) => (
            <SyllabusTree
              tree={d.tree}
              selectedScope={null}
              onSelectScope={(scope) => {
                if (!scope) return
                // Studying is chapter-scoped: resolve any clicked section to its chapter.
                const chapter = findChapterForSection(d.tree, scope)
                if (chapter?.sectionKey) onOpenSection(chapter.sectionKey)
              }}
              masteryBySection={data.mastery?.bySection}
              docId={course.learnDocId}
              onSelectConcept={onOpenConcept}
              onConceptReviewed={data.refresh}
              autoHeight
            />
          )}
        </AsyncView>
      )}
    </Sheet>
  )
}
