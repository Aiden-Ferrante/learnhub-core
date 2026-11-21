"use client"

/** /courses/[id]/chapters/[chapterKey]/learn — the chapter's Review (v0.32.0), entered from the
 *  hub's Review card, always available (human, 2026-11-21).
 *
 *  Top page: the master list of the chapter's concepts as a tree by subchapter, a checkbox per
 *  subchapter for what to pool from, and a block length of 10–25 minutes. A block runs in Learn
 *  mode; its concept list is a snapshot so the grades' refetch cannot reshuffle it. After a
 *  block: the next block (same choices, statuses refreshed) or back to the list. */

import { use, useMemo, useState } from "react"
import { StudyPage } from "@/kit/study"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { chaptersHref, chapterSteps, CourseFallback, plainTitle, stepLabel, useChapters, useCourseData } from "@/surfaces/library"
import {
  LearnSession,
  pickBlock,
  ReviewSetup,
  useChapterReview,
  type LearnConcept,
  type ReviewGroup,
} from "@/surfaces/studying"

const within = (n: LearnTreeNode, key: string): boolean => n.sectionKey === key || n.children.some((c) => within(c, key))

type Block = { n: number; concepts: LearnConcept[]; minutes: number; groupIds: string[] }

export default function ChapterReviewPage({ params }: { params: Promise<{ courseId: string; chapterKey: string }> }) {
  const { courseId, chapterKey: raw } = use(params)
  const chapterKey = decodeURIComponent(raw)

  const data = useCourseData(courseId)
  const { chapters, numbers } = useChapters(data.tree)
  const chapter = chapters.find((c) => c.sectionKey === chapterKey)
  const steps = useMemo(() => (chapter ? chapterSteps(chapter) : []), [chapter])
  const docId = data.course?.learnDocId ?? undefined
  const review = useChapterReview(docId, chapter)
  const [block, setBlock] = useState<Block | null>(null)

  // The master list: one group per reading section in book order, then chapter-level leftovers.
  const groups: ReviewGroup[] = useMemo(() => {
    const placed = new Set<string>()
    const out = steps.map((s, i) => {
      const concepts = review.bookOrder.filter((c) => within(s, c.sectionKey))
      concepts.forEach((c) => placed.add(c.key))
      return { id: s.sectionKey!, label: `${stepLabel(numbers, s, i)} ${plainTitle(s)}`, concepts }
    })
    const rest = review.bookOrder.filter((c) => !placed.has(c.key))
    return [...out, ...(rest.length ? [{ id: "rest", label: "Also in this chapter", concepts: rest }] : [])].filter(
      (g) => g.concepts.length > 0,
    )
  }, [steps, numbers, review.bookOrder])

  if (!data.course) {
    return (
      <StudyPage>
        <CourseFallback isInitialized={data.isInitialized} />
      </StudyPage>
    )
  }
  const chapterNo = chapter ? numbers.get(chapter.id) : undefined
  const back = chaptersHref(courseId, chapterKey)
  const title = chapter ? plainTitle(chapter) : "This chapter"

  const start = (concepts: LearnConcept[], minutes: number, groupIds: string[], n = 1) =>
    setBlock({ n, concepts, minutes, groupIds })
  const nextBlock = () => {
    if (!block) return
    const chosen = groups.filter((g) => block.groupIds.includes(g.id))
    start(pickBlock(chosen, review.status, block.minutes), block.minutes, block.groupIds, block.n + 1)
  }

  let body: React.ReactNode
  if (review.loading && !block) {
    body = <p className="text-muted-foreground">Loading…</p>
  } else if (review.error) {
    body = <p className="text-ink-danger">Couldn’t load this chapter’s concepts. {review.error}</p>
  } else if (groups.length === 0) {
    body = (
      <p className="text-muted-foreground">
        This chapter has no concepts to review.{" "}
        <a href={back} className="underline">
          Back to the chapter
        </a>
      </p>
    )
  } else if (!block) {
    body = (
      <ReviewSetup
        storageKey={`lh-review-setup:${docId}:${chapterKey}`}
        eyebrow={`Review · Chapter ${chapterNo ?? ""}`.trim()}
        title={title}
        groups={groups}
        status={review.status}
        onStart={start}
      />
    )
  } else {
    body = (
      <LearnSession
        key={`${docId}:${chapterKey}:${block.n}`}
        docId={docId!}
        mode="learn"
        concepts={block.concepts}
        pool={review.pool}
        heading={`Block ${block.n} · ${block.minutes} min`}
        title={title}
        backHref={back}
        backLabel={chapterNo ? `Chapter ${chapterNo}` : "Chapter"}
        groups={groups.map((g) => ({ label: g.label, keys: g.concepts.map((c) => c.key) }))}
        endActions={[
          { label: "Next block", onClick: nextBlock, primary: true },
          { label: "Back to the concept list", onClick: () => setBlock(null) },
        ]}
      />
    )
  }
  return <StudyPage wide>{body}</StudyPage>
}
