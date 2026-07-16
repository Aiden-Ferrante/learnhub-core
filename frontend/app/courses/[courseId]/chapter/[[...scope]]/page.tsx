"use client"

import { Suspense, use, useCallback, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { GuidedReading } from "@/features/learn"
import { CourseFallback } from "@/features/learn"
import { useCourseData } from "@/features/learn"
import { scopeFromSegments, scopeToPath } from "@/features/learn"

type Params = Promise<{ courseId: string; scope?: string[] }>

const DRAWERS = ["quiz", "review", "exam", "walk", "lockin", "tutor", "listen"] as const
type Drawer = (typeof DRAWERS)[number]

function ChapterInner({ params }: { params: Params }) {
  const { courseId, scope: scopeSegments } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const data = useCourseData(courseId)

  // Scope lives in component state, seeded from the URL. In-reader navigation updates
  // the address bar with history.replaceState — shareable links without a Next
  // navigation, so the reader never remounts mid-read.
  const [scope, setScope] = useState<string | null>(() => scopeFromSegments(scopeSegments))

  const drawerParam = search.get("drawer")
  const initialDrawer = DRAWERS.includes(drawerParam as Drawer) ? (drawerParam as Drawer) : undefined

  const handleScopeChange = useCallback(
    (sectionKey: string) => {
      setScope(sectionKey)
      data.persistReadingPosition(sectionKey)
      window.history.replaceState(
        null,
        "",
        `/courses/${courseId}/chapter/${scopeToPath(sectionKey)}`,
      )
    },
    [courseId, data.persistReadingPosition],
  )

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />

  return (
    <main className="mx-auto w-full px-4 pb-3 pt-3">
      <GuidedReading
        course={data.course}
        scope={scope}
        tree={data.tree}
        onBack={() => router.push(`/courses/${courseId}`)}
        onScopeChange={handleScopeChange}
        initialDrawer={initialDrawer}
      />
    </main>
  )
}

export default function ChapterPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <ChapterInner params={params} />
    </Suspense>
  )
}
