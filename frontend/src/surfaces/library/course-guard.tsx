"use client"

import Link from "next/link"
import { BookX } from "lucide-react"
import { EmptyState } from "@/kit/patterns/empty-state"
import { SkeletonCard, SkeletonStatStrip } from "@/kit/patterns/skeletons"

/** What a course route renders while documents load, or when the id matches nothing. */
export function CourseFallback({ isInitialized }: { isInitialized: boolean }) {
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
          <Link href="/courses" className="text-sm font-medium text-brand hover:underline">
            Back to courses
          </Link>
        }
      />
    </div>
  )
}
