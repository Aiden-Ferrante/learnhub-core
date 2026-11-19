"use client"

/** /courses/[id]/chapters/[chapterKey]/path — the v0.31.5 trial address of the chapter path;
 *  the path is part of the chapter page now (2026-11-19). */

import { use, useEffect } from "react"
import { useRouter } from "next/navigation"

export default function ChapterPathRedirect({
  params,
}: {
  params: Promise<{ courseId: string; chapterKey: string }>
}) {
  const { courseId, chapterKey } = use(params)
  const router = useRouter()
  useEffect(() => router.replace(`/courses/${courseId}/chapters/${chapterKey}`), [router, courseId, chapterKey])
  return null
}
