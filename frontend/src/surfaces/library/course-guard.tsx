"use client"

import Link from "next/link"
import { BookX } from "lucide-react"
import { EmptyState } from "@/kit/patterns/empty-state"
import { SkeletonCard, SkeletonStatStrip } from "@/kit/patterns/skeletons"
import { ErrorNotice } from "@/kit/data/error-notice"
import { useDocuments } from "@/surfaces/processing"

/** What a course route renders while documents load, when the library failed to load
 *  ("Couldn't load your library" + Retry), or when the id matches nothing ("not found").
 *  `isInitialized` is kept for the existing call sites; the load error comes from the
 *  documents context. */
export function CourseFallback({ isInitialized }: { isInitialized: boolean }) {
  const { error, retry } = useDocuments()
  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ErrorNotice title="Couldn't load your library" error={error} onRetry={retry} />
      </div>
    )
  }
  if (!isInitialized) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-6">
        <SkeletonCard />
        <SkeletonStatStrip />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-3xl py-10">
      <EmptyState
        icon={<BookX />}
        title="Course not found"
        description="This link doesn't match any of your courses — it may have been deleted."
        action={
          <Link href="/courses" className="text-sm font-medium text-ink-accent hover:underline">
            Back to Library
          </Link>
        }
      />
    </div>
  )
}
