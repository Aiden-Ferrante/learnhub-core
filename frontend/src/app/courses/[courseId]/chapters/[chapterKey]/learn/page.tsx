"use client"

/** /courses/[id]/chapters/[chapterKey]/learn — Learn mode (v0.32.0), entered from the chapter
 *  hub's Review card only. `?section=<sectionKey>` learns that section's unlearned concepts;
 *  `?due=1` reviews the chapter's due concepts (explain-only). The concept list is a snapshot
 *  taken once the queue loads: grades refetch the queue and must not reshuffle a session. */

import { useSearchParams } from "next/navigation"
import { use, useEffect, useMemo, useState } from "react"
import { StudyPage } from "@/kit/study"
import { useReadSteps } from "@/kit/lib/read-steps"
import {
  chaptersHref,
  chapterStepHref,
  chapterSteps,
  CourseFallback,
  plainTitle,
  stepLabel,
  useChapters,
  useCourseData,
} from "@/surfaces/library"
import { LearnSession, useChapterReview, type LearnConcept } from "@/surfaces/studying"

type Snapshot = { id: string; concepts: LearnConcept[]; pool: LearnConcept[] }

export default function LearnPage({ params }: { params: Promise<{ courseId: string; chapterKey: string }> }) {
  const { courseId, chapterKey: raw } = use(params)
  const chapterKey = decodeURIComponent(raw)
  const search = useSearchParams()
  const sectionKey = search.get("section")
  const due = search.get("due") === "1"

  const data = useCourseData(courseId)
  const { chapters, numbers } = useChapters(data.tree)
  const chapter = chapters.find((c) => c.sectionKey === chapterKey)
  const steps = useMemo(() => (chapter ? chapterSteps(chapter) : []), [chapter])
  const docId = data.course?.learnDocId ?? undefined
  const { read } = useReadSteps(docId)
  const review = useChapterReview(docId, chapter, steps, read)

  const id = `${docId}:${chapterKey}:${due ? "due" : sectionKey}`
  const [snap, setSnap] = useState<Snapshot | null>(null)
  useEffect(() => {
    if (review.loading || (snap && snap.id === id)) return
    const concepts = due ? review.due : sectionKey ? review.unlearned.get(sectionKey) ?? [] : []
    setSnap({ id, concepts, pool: review.pool })
  }, [review, id, due, sectionKey, snap])

  if (!data.course) {
    return (
      <StudyPage>
        <CourseFallback isInitialized={data.isInitialized} />
      </StudyPage>
    )
  }
  const index = steps.findIndex((s) => s.sectionKey === sectionKey)
  const node = index >= 0 ? steps[index] : undefined
  const label = node ? stepLabel(numbers, node, index) : ""
  const chapterNo = chapter ? numbers.get(chapter.id) : undefined
  const back = chaptersHref(courseId, chapterKey)
  const title = due ? (chapter ? plainTitle(chapter) : "This chapter") : node ? `${label} ${plainTitle(node)}` : "This section"

  // After learning a section: read the next section not yet read, else back to the chapter.
  const nextUnread = steps.findIndex((s, i) => i > index && !read.has(s.sectionKey!))
  const next =
    !due && nextUnread >= 0
      ? { href: chapterStepHref(courseId, chapterKey, nextUnread), label: `Next: read ${stepLabel(numbers, steps[nextUnread], nextUnread)} ${plainTitle(steps[nextUnread])}` }
      : undefined

  let body: React.ReactNode
  if (!snap || snap.id !== id) {
    body = <p className="text-muted-foreground">Loading…</p>
  } else if (review.error) {
    body = <p className="text-ink-danger">Couldn’t load this chapter’s concepts. {review.error}</p>
  } else if (snap.concepts.length === 0) {
    body = (
      <p className="text-muted-foreground">
        {due ? "Nothing is due in this chapter." : "Nothing left to learn in this section."}{" "}
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
        mode={due ? "due" : "learn"}
        concepts={snap.concepts}
        pool={snap.pool}
        heading={due ? `Due · Chapter ${chapterNo ?? ""}`.trim() : `Learning · ${label}`}
        title={title}
        backHref={back}
        backLabel={chapterNo ? `Chapter ${chapterNo}` : "Chapter"}
        bookHref={!due && index >= 0 ? chapterStepHref(courseId, chapterKey, index) : undefined}
        next={next}
      />
    )
  }
  return <StudyPage wide>{body}</StudyPage>
}
