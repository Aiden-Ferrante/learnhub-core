"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { CourseHome } from "@/features/learn/components/home/course-home"
import { CourseFallback } from "@/features/learn/components/course-guard"
import { useCourseData } from "@/features/learn/hooks/use-course-data"
import { chapterHref } from "@/features/learn/lib/scope-url"

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
        edgeCount={data.edgeCount}
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
        onAsk={() => router.push(`/courses/${courseId}/ask`)}
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
