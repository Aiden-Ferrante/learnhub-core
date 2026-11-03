"use client"

import { Suspense, use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ConceptsView } from "@/surfaces/concepts"
import { CourseFallback, useCourseData } from "@/surfaces/library"

type Params = Promise<{ courseId: string }>

/** /courses/[id]/concepts, with `?concept=<key>` for one concept's lesson (deep-linked
 *  from the syllabus tree). Opening a concept pushes, so browser Back returns to the list. */
function ConceptsInner({ params }: { params: Params }) {
  const { courseId } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const data = useCourseData(courseId)

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  const base = `/courses/${courseId}/concepts`
  return (
    <ConceptsView
      course={data.course}
      tree={data.tree}
      conceptKey={search.get("concept")}
      onSelect={(key) => router.push(key ? `${base}?concept=${encodeURIComponent(key)}` : base)}
    />
  )
}

export default function ConceptsPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <ConceptsInner params={params} />
    </Suspense>
  )
}
