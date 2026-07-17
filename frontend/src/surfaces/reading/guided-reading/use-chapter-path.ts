"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useToast } from "@/kit/hooks/use-toast"
import { PATH_STAGES, doneMap } from "@/surfaces/reading/learn-path"
import { fetchChapterProgress, updateChapterStage } from "@/gateways/api/chapter"

/** The chapter path's stage machine: {stageKey: done} from chapter_progress — the same
 *  store the old lesson flow wrote, so history carries over. Owns loading, marking (with
 *  the "what now?" toast), and the quiz soft gate (5 real answers mark the quizzes stage).
 *  The read soft gate lives in use-reader-scroll and calls markStage back. */
export function useChapterPath(chapterKey: string | null, docId: string) {
  const [stages, setStages] = useState<Record<string, boolean>>({})
  const { toast } = useToast()
  // Soft-gate counter for the quiz stage (nothing else reports it).
  const quizAnswers = useRef(0)

  const loadProgress = useCallback(async () => {
    if (!chapterKey) return
    try {
      const p = await fetchChapterProgress(chapterKey, docId)
      setStages(doneMap(p.stages))
    } catch {
      // progress is supplementary — never break the reader
    }
  }, [chapterKey, docId])

  useEffect(() => {
    setStages({})
    quizAnswers.current = 0
    loadProgress()
  }, [loadProgress])

  const markStage = useCallback(
    (key: string) => {
      if (!chapterKey) return
      // Announce the flip — the rail's checkmark alone is easy to miss, and "what now?"
      // is the question every stage completion raises.
      if (!stages[key]) {
        const i = PATH_STAGES.findIndex((p) => p.key === key)
        const next = PATH_STAGES[i + 1]
        toast({
          title: `${PATH_STAGES[i]?.label ?? key} complete ✓`,
          description: next ? `Next: ${next.label} — ${next.lead}` : "Chapter path complete.",
        })
      }
      setStages((s) => ({ ...s, [key]: true }))
      updateChapterStage(chapterKey, docId, key, { done: true })
        .then(() => loadProgress())
        .catch(() => {})
    },
    [chapterKey, docId, loadProgress, stages, toast],
  )

  const noteQuizAnswer = () => {
    quizAnswers.current += 1
    if (quizAnswers.current >= 5 && !stages.quizzes) markStage("quizzes")
  }

  return { stages, loadProgress, markStage, noteQuizAnswer }
}
