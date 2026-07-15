"use client"

import { Suspense, use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ConceptsView } from "@/features/learn/components/concepts/concepts-view"
import { CourseFallback } from "@/features/learn/components/course-guard"
import { useCourseData } from "@/features/learn/hooks/use-course-data"

type Params = Promise<{ courseId: string }>

function ConceptsInner({ params }: { params: Params }) {
  const { courseId } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <ConceptsView
        course={data.course}
        onBack={() => router.push(`/courses/${courseId}`)}
        initialConceptKey={search.get("concept")}
      />
    </main>
  )
}

export default function ConceptsPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <ConceptsInner params={params} />
    </Suspense>
  )
}
