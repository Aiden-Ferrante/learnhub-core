"use client"

import type React from "react"
import Link from "next/link"
import { BookOpen, GraduationCap, ListTree, RotateCcw, Sparkles } from "lucide-react"
import { displaySectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { ErrorNotice } from "@/kit/data"
import { chapterHref } from "@/kit/lib/scope-url"
import { Sheet } from "@/kit/study"
import type { CourseData } from "@/surfaces/library/use-course-data"
import type { CourseHomeData } from "@/surfaces/library/use-course-home"

function Tile({
  href,
  icon,
  title,
  value,
  sub,
}: {
  href: string
  icon: React.ReactNode
  title: string
  value: string
  sub: string
}) {
  return (
    <Link href={href} className="group block rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Sheet as="div" className="h-full gap-1 transition-colors group-hover:border-brand/50">
        <span className="flex items-center gap-2 text-meta font-medium text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
          {icon}
          {title}
        </span>
        <span className="truncate text-title font-semibold tabular-nums">{value}</span>
        <span className="line-clamp-2 text-micro text-muted-foreground">{sub}</span>
      </Sheet>
    </Link>
  )
}

function continueLabel(node: LearnTreeNode | null): string {
  return node ? displaySectionTitle(node.label, node.title) : "Start reading"
}

/** The five study tiles (docs/ui-spec.md §3): Review, Exam packs, Read, Concepts and
 *  Skeleton recall. A read that failed shows "—" on its tile and a Retry line below. */
export function StudyTiles({ courseId, data, home }: { courseId: string; data: CourseData; home: CourseHomeData }) {
  const base = `/courses/${courseId}`
  const debt = data.queries.debt
  const { packs, today, activePack } = home.next
  const due = data.reviewDue

  const reviewValue = due === null ? (debt.status === "loading" ? "…" : "—") : due > 0 ? `${due} due` : "Caught up"
  const readyPacks = packs.data?.packs.filter((p) => p.status === "ready").length ?? 0
  const packsValue = packs.data
    ? packs.data.packs.length === 0
      ? "No packs yet"
      : `${readyPacks} ready`
    : packs.status === "error"
      ? "—"
      : "…"
  const packsSub = today.data?.now
    ? `Next: ${today.data.now.title}`
    : activePack
      ? `${activePack.title}: nothing due now`
      : "Pick chapters, get a Learn walk and a fresh exam."
  const conceptsValue =
    home.conceptCount !== null ? String(home.conceptCount) : home.concepts.status === "error" ? "—" : "…"

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          href={`${base}/review`}
          icon={<RotateCcw />}
          title="Review"
          value={reviewValue}
          sub="Every due card in this course."
        />
        <Tile href={`${base}/packs`} icon={<GraduationCap />} title="Exam packs" value={packsValue} sub={packsSub} />
        <Tile
          href={chapterHref(courseId, data.continueSectionKey ?? null)}
          icon={<BookOpen />}
          title="Read"
          value={continueLabel(data.continueNode)}
          sub={data.continueNode ? "Continue guided reading." : "Guided reading, a chapter at a time."}
        />
        <Tile href={`${base}/concepts`} icon={<Sparkles />} title="Concepts" value={conceptsValue} sub="Everything extracted from the book." />
        <Tile
          href={`${base}/skeleton`}
          icon={<ListTree />}
          title="Skeleton recall"
          value="Recall"
          sub="Chapters → sections → concepts, from memory."
        />
      </div>
      {debt.error && <ErrorNotice compact title="Couldn't load what's due" error={debt.error} onRetry={debt.retry} />}
      {packs.error && <ErrorNotice compact title="Couldn't load packs" error={packs.error} onRetry={packs.retry} />}
      {today.error && <ErrorNotice compact title="Couldn't load the pack's next step" error={today.error} onRetry={today.retry} />}
      {home.concepts.error && (
        <ErrorNotice compact title="Couldn't load concepts" error={home.concepts.error} onRetry={home.concepts.retry} />
      )}
    </div>
  )
}
