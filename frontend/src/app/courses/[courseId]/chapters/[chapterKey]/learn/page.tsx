"use client"

/** /courses/[id]/chapters/[chapterKey]/learn — the chapter's Review (v0.32.0), entered from the
 *  hub's Review card only. Always available and comprehensive (human, 2026-11-21): every concept
 *  in the chapter, due ones first, then book order, in Learn mode. The concept list is a snapshot
 *  taken once the queue loads: grades refetch the queue and must not reshuffle a session. */

import { use, useEffect, useMemo, useState } from "react"
import { StudyPage } from "@/kit/study"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { chaptersHref, chapterSteps, CourseFallback, plainTitle, stepLabel, useChapters, useCourseData } from "@/surfaces/library"
import { LearnSession, useChapterReview, type LearnConcept } from "@/surfaces/studying"

type Snapshot = { id: string; concepts: LearnConcept[]; pool: LearnConcept[] }

const within = (n: LearnTreeNode, key: string): boolean => n.sectionKey === key || n.children.some((c) => within(c, key))

export default function ChapterReviewPage({ params }: { params: Promise<{ courseId: string; chapterKey: string }> }) {
  const { courseId, chapterKey: raw } = use(params)
  const chapterKey = decodeURIComponent(raw)

  const data = useCourseData(courseId)
  const { chapters, numbers } = useChapters(data.tree)
  const chapter = chapters.find((c) => c.sectionKey === chapterKey)
  const steps = useMemo(() => (chapter ? chapterSteps(chapter) : []), [chapter])
  const docId = data.course?.learnDocId ?? undefined
  const review = useChapterReview(docId, chapter)

  const id = `${docId}:${chapterKey}`
  const [snap, setSnap] = useState<Snapshot | null>(null)
  useEffect(() => {
    if (review.loading || (snap && snap.id === id)) return
    setSnap({ id, concepts: review.chapterSet, pool: review.pool })
  }, [review, id, snap])

  if (!data.course) {
    return (
      <StudyPage>
        <CourseFallback isInitialized={data.isInitialized} />
      </StudyPage>
    )
  }
  const chapterNo = chapter ? numbers.get(chapter.id) : undefined
  const back = chaptersHref(courseId, chapterKey)

  // Rail groups: one per reading section in book order, then anything left (chapter-level).
  const groups = snap
    ? (() => {
        const placed = new Set<string>()
        const out = steps.map((s, i) => {
          const keys = snap.concepts.filter((c) => within(s, c.sectionKey)).map((c) => c.key)
          keys.forEach((k) => placed.add(k))
          return { label: `${stepLabel(numbers, s, i)} ${plainTitle(s)}`, keys }
        })
        const rest = snap.concepts.filter((c) => !placed.has(c.key)).map((c) => c.key)
        return rest.length ? [...out, { label: "Also in this chapter", keys: rest }] : out
      })()
    : []

  let body: React.ReactNode
  if (!snap || snap.id !== id) {
    body = <p className="text-muted-foreground">Loading…</p>
  } else if (review.error) {
    body = <p className="text-ink-danger">Couldn’t load this chapter’s concepts. {review.error}</p>
  } else if (snap.concepts.length === 0) {
    body = (
      <p className="text-muted-foreground">
        This chapter has no concepts to review.{" "}
        <a href={back} className="underline">
          Back to the chapter
        </a>
      </p>
    )
  } else {
    body = (
      <LearnSession
        key={snap.id}
        docId={docId!}
        mode="learn"
        concepts={snap.concepts}
        pool={snap.pool}
        heading={`Review · Chapter ${chapterNo ?? ""}`.trim()}
        title={chapter ? plainTitle(chapter) : "This chapter"}
        backHref={back}
        backLabel={chapterNo ? `Chapter ${chapterNo}` : "Chapter"}
        groups={groups}
      />
    )
  }
  return <StudyPage wide>{body}</StudyPage>
}
