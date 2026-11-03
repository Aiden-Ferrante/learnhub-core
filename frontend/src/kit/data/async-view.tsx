"use client"

import type React from "react"
import { SkeletonRow } from "@/kit/patterns/skeletons"
import { EmptyState } from "@/kit/patterns/empty-state"
import { ErrorNotice } from "@/kit/data/error-notice"
import type { ApiQuery } from "@/kit/data/use-api"

/** Renders one query the same way on every screen:
 *  loading → `skeleton` (default: three SkeletonRows)
 *  error   → ErrorNotice with the message and Retry (`error="inline"` for the one-line
 *            form, `error="silent"` to render nothing, for optional side panels)
 *  empty   → `empty` (an EmptyState) when `isEmpty(data)` is true
 *  data    → `children(data)`.
 *  A background refetch keeps showing the data (no skeleton flash).
 *
 *  @example
 *  const q = useApi(qk.packs(docId), (s) => fetchPacks(docId, s))
 *  <AsyncView q={q} isEmpty={(d) => d.packs.length === 0}
 *    empty={<EmptyState title="No packs yet" description="Build one from a few chapters." />}>
 *    {(d) => <PackList packs={d.packs} />}
 *  </AsyncView>
 */
export function AsyncView<T>({
  q,
  children,
  skeleton,
  isEmpty,
  empty,
  error = "block",
  errorTitle,
}: {
  q: ApiQuery<T>
  children: (data: T) => React.ReactNode
  /** What to show before the first data arrives. */
  skeleton?: React.ReactNode
  /** Decide emptiness from the data (e.g. `d => d.items.length === 0`). */
  isEmpty?: (data: T) => boolean
  /** What to show when `isEmpty` is true. Default: a plain "Nothing here yet". */
  empty?: React.ReactNode
  error?: "block" | "inline" | "silent"
  /** Lead line of the error, e.g. "Couldn't load your packs". */
  errorTitle?: string
}) {
  if (q.data === undefined) {
    if (q.status === "error") {
      if (error === "silent") return null
      return <ErrorNotice error={q.error} onRetry={q.retry} title={errorTitle} compact={error === "inline"} />
    }
    return <>{skeleton ?? <DefaultSkeleton />}</>
  }
  if (isEmpty?.(q.data)) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>
  return (
    <>
      {/* A failed REFETCH keeps the data on screen and says so in one line. */}
      {q.status === "error" && error !== "silent" && (
        <ErrorNotice compact error={q.error} onRetry={q.retry} title={errorTitle ?? "Couldn't refresh"} className="mb-2" />
      )}
      {children(q.data)}
    </>
  )
}

function DefaultSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  )
}
