"use client"

import { Suspense, use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ConceptsView } from "@/features/learn"
import { CourseFallback } from "@/features/learn"
import { useCourseData } from "@/features/learn"

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
        tree={data.tree}
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
