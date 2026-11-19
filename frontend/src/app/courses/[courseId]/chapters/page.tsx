"use client"

/** /courses/[id]/chapters — the trial address of the chapter cards; they are the course page now. */

import { use, useEffect } from "react"
import { useRouter } from "next/navigation"

export default function ChaptersRedirect({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  useEffect(() => router.replace(`/courses/${courseId}`), [router, courseId])
  return null
}
