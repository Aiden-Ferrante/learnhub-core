"use client"

/** The chapter hub's Review card (v0.32.0): always available, a comprehensive review of the whole
 *  chapter in Learn mode (human, 2026-11-21: "I want the Review card to always be available … not
 *  unlocked like the exams … a comprehensive review of the chapter"). Separate from the guided
 *  reading path. Due concepts come first in the session; the card says how many. */

import Link from "next/link"
import { cn } from "@/kit/lib/utils"
import type { ChapterReview } from "@/surfaces/studying"

export function ReviewCard({
  className,
  label,
  review,
  href,
}: {
  className: string
  label: string
  review: ChapterReview
  href: string
}) {
  const total = review.chapterSet.length
  const due = review.due.length
  const parts = [due > 0 ? `${due} due` : null, review.newCount > 0 ? `${review.newCount} new` : null].filter(Boolean)
  return (
    <div className={cn(className, due > 0 && "border-primary/70")}>
      <div className="min-w-0 flex-1">
        <span className={label}>Review</span>
        <span className="block truncate font-semibold">
          {review.loading ? (
            <span className="text-muted-foreground">Loading…</span>
          ) : total > 0 ? (
            `The whole chapter · ${total} concept${total === 1 ? "" : "s"}`
          ) : (
            <span className="text-muted-foreground">No concepts in this chapter</span>
          )}
        </span>
        {!review.loading && total > 0 && (
          <span className="block truncate text-xs text-muted-foreground">
            {parts.length ? `${parts.join(" · ")} · ` : due === 0 ? "nothing due · " : ""}
            {due > 0 ? "due ones first" : `about ${Math.max(1, Math.round(total * 0.75))} min`}
          </span>
        )}
      </div>
      {total > 0 && (
        <Link href={href} className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
          {due > 0 ? "Review now" : "Start"}
        </Link>
      )}
    </div>
  )
}
