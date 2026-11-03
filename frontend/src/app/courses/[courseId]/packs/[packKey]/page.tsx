"use client"

import { Suspense, use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PackView, parsePackTab, type PackTab } from "@/surfaces/practicing"

type Params = Promise<{ courseId: string; packKey: string }>

/** /courses/[id]/packs/[key]?tab=today|learn|exam|results. The tab lives in the URL so a
 *  reload or a shared link lands on it (docs/ui-spec.md §2). Switching tabs replaces the
 *  history entry, so Back leaves the pack instead of walking back through its tabs. */
function PackInner({ params }: { params: Params }) {
  const { courseId, packKey } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const tab = parsePackTab(search.get("tab"))
  const onTab = (t: PackTab) => router.replace(`/courses/${courseId}/packs/${packKey}?tab=${t}`)
  return <PackView packKey={packKey} tab={tab} onTab={onTab} />
}

export default function PackPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <PackInner params={params} />
    </Suspense>
  )
}
