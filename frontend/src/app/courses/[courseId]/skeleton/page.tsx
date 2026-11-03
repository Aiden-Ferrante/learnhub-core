"use client"

/** /courses/[id]/skeleton — skeleton recall over the whole course, on the study theme.
 *  The breadcrumbs (Library › Course › Skeleton) are the way back. */

import { use } from "react"
import { CourseFallback, useCourseData } from "@/surfaces/library"
import { SkeletonPractice } from "@/surfaces/studying"
import { StudyPage } from "@/kit/study"
import { PageHeader } from "@/kit/patterns/page-header"
import { ErrorNotice } from "@/kit/data"

export default function SkeletonPracticePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <StudyPage narrow>
      <PageHeader title="Skeleton recall" description="Rebuild the book's structure from memory, one level at a time." />
      {data.error ? (
        <ErrorNotice title="Couldn't load the syllabus" error={new Error(data.error)} onRetry={data.retry} />
      ) : (
        <SkeletonPractice
          courseTitle={data.course.title}
          docId={data.docKey ?? data.course.id}
          tree={data.tree}
          loading={data.loading}
        />
      )}
    </StudyPage>
  )
}
