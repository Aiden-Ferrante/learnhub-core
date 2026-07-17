"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { CourseHome } from "@/surfaces/library"
import { CourseFallback } from "@/surfaces/library"
import { useCourseData } from "@/surfaces/library"
import { chapterHref } from "@/kit/lib/scope-url"

export default function CourseHomePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  const openChapter = (scope: string | null, opts?: { drawer?: string; all?: boolean }) => {
    if (scope) data.persistReadingPosition(scope)
    router.push(chapterHref(courseId, scope, opts))
  }

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <CourseHome
        course={data.course}
        tree={data.tree}
        sectionCount={data.sectionCount}
        loading={data.loading}
        error={data.error}
        mastery={data.mastery}
        onOpenSection={(scope) => openChapter(scope)}
        onReview={(section) => openChapter(section.sectionKey, { drawer: "review" })}
        onReadBook={() => router.push(`/courses/${courseId}/read`)}
        onDeepRead={() => openChapter(data.continueSectionKey ?? null)}
        onViewConcepts={() => router.push(`/courses/${courseId}/concepts`)}
        onOpenConcept={(conceptKey) =>
          router.push(`/courses/${courseId}/concepts?concept=${encodeURIComponent(conceptKey)}`)
        }
        onDrill={() => router.push(`/courses/${courseId}/drill`)}
        onBrainDump={() => router.push(`/courses/${courseId}/dump`)}
        onBackToShelf={() => router.push("/courses")}
        continueNode={data.continueNode}
        dueCount={data.reviewDue}
        onReviewAll={() => openChapter(data.continueSectionKey ?? null, { drawer: "review", all: true })}
        onRetry={data.retry}
      />
    </main>
  )
}
