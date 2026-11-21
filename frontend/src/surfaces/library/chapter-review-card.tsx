"use client"

/** The chapter hub's Review card (v0.32.0): the only way into Learn mode (human, 2026-11-21: the
 *  Quizlet-like questions "is supposed to be what the second card in the chapter hub is", kept
 *  separate from the guided reading path).
 *
 *  States: N due (spaced repetition) · learn the first read section with unlearned concepts ·
 *  all caught up · opens after your first section. Its counts are exactly what Learn serves. */

import Link from "next/link"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { cn } from "@/kit/lib/utils"
import { stepLabel } from "@/surfaces/library/chapter-path"
import type { ChapterReview } from "@/surfaces/studying"

const within = (n: LearnTreeNode, key: string): boolean => n.sectionKey === key || n.children.some((c) => within(c, key))

export function ReviewCard({
  className,
  label,
  review,
  numbers,
  steps,
  learnHref,
  dueHref,
  anyRead,
}: {
  className: string
  label: string
  review: ChapterReview
  numbers: Map<string, string>
  steps: LearnTreeNode[]
  learnHref: (sectionKey: string) => string
  dueHref: string
  /** At least one section of the chapter has been read. */
  anyRead: boolean
}) {
  const nameOf = (node: LearnTreeNode) => stepLabel(numbers, node, steps.indexOf(node))
  const learn = review.nextLearn
  const learnLine = learn
    ? `Learn ${nameOf(learn.node)} · ${learn.concepts.length} concept${learn.concepts.length === 1 ? "" : "s"}`
    : null
  const n = review.due.length
  const from = Array.from(
    new Set(review.due.map((c) => steps.find((s) => within(s, c.sectionKey))).filter(Boolean).map((s) => nameOf(s!))),
  )

  let title: React.ReactNode
  let sub: React.ReactNode = null
  let action: { href: string; text: string } | null = null
  if (review.loading) {
    title = <span className="text-muted-foreground">Loading…</span>
  } else if (n > 0) {
    title = `${n} due · about ${Math.max(1, Math.round((n * 40) / 60))} min`
    sub = learnLine ? (
      <Link href={learnHref(learn!.node.sectionKey!)} className="underline-offset-2 hover:text-foreground hover:underline">
        then {learnLine.charAt(0).toLowerCase() + learnLine.slice(1)}
      </Link>
    ) : from.length ? (
      `from ${from.join(", ")}`
    ) : null
    action = { href: dueHref, text: "Review now" }
  } else if (learn) {
    title = learnLine
    sub = `about ${Math.max(1, learn.concepts.length)} min`
    action = { href: learnHref(learn.node.sectionKey!), text: "Start" }
  } else if (anyRead) {
    title = <span className="text-ink-ok">All caught up</span>
    sub = review.later > 0 ? `${review.later} scheduled for later` : "Learn opens as you read more sections"
  } else {
    title = <span className="text-muted-foreground">Opens after your first section</span>
  }

  return (
    <div className={cn(className, action && "border-primary/70")}>
      <div className="min-w-0 flex-1">
        <span className={label}>Review</span>
        <span className="block truncate font-semibold">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </div>
      {action && (
        <Link href={action.href} className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
          {action.text}
        </Link>
      )}
    </div>
  )
}
