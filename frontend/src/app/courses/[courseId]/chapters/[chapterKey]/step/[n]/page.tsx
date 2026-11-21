"use client"

/** /courses/[id]/chapters/[chapterKey]/step/[n] — TRIAL (v0.31.5): read one step of a chapter. */

import { use, useMemo } from "react"
import {
  chapterPathHref,
  chapterStepHref,
  chapterSteps,
  CourseFallback,
  plainTitle,
  stepLabel,
  useChapters,
  useCourseData,
} from "@/surfaces/library"
import { StepReader } from "@/surfaces/reading"

export default function ChapterStepPage({
  params,
}: {
  params: Promise<{ courseId: string; chapterKey: string; n: string }>
}) {
  const { courseId, chapterKey: raw, n } = use(params)
  const chapterKey = decodeURIComponent(raw)
  const data = useCourseData(courseId)
  const { chapters, numbers } = useChapters(data.tree)
  const chapter = chapters.find((c) => c.sectionKey === chapterKey)
  const steps = useMemo(
    () => (chapter ? chapterSteps(chapter).map((node, i) => ({ node, title: plainTitle(node), label: stepLabel(numbers, node, i) })) : []),
    [chapter, numbers],
  )

  if (!data.course) return <CourseFallback isInitialized={data.isInitialized} />
  if (!chapter || steps.length === 0) {
    return <p className="p-8 text-muted-foreground">{data.loading ? "Loading…" : "This chapter has no steps to read."}</p>
  }
  const index = Math.min(Math.max(Number(n) - 1 || 0, 0), steps.length - 1)

  return (
    <StepReader
      docId={data.course.learnDocId!}
      chapterNumber={numbers.get(chapter.id)}
      chapterTitle={plainTitle(chapter)}
      steps={steps}
      index={index}
      stepHref={(i) => chapterStepHref(courseId, chapterKey, i)}
      pathHref={chapterPathHref(courseId, chapterKey)}
      onOpen={(key) => data.persistReadingPosition(key)}
    />
  )
}
