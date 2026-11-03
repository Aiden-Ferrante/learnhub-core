"use client"

import { useCallback, useMemo, useRef } from "react"
import { useToast } from "@/kit/hooks/use-toast"
import { qk, useApi, useApiMutation } from "@/kit/data"
import { PATH_STAGES, doneMap } from "@/surfaces/reading/learn-path"
import { fetchChapterProgress, updateChapterStage } from "@/gateways/api/chapter"

/** The chapter path's stage machine: {stageKey: done} from chapter_progress (the same
 *  store the old lesson flow wrote, so history carries over), read as a keyed query so a
 *  chapter switch can't land the previous chapter's checkmarks. Marking a stage is a
 *  mutation: the checkmark and the "what now?" toast follow the write, and a failed write
 *  is returned as `markError` for the bar to show. The read soft gate lives in
 *  use-reader-scroll and calls markStage back. */
export function useChapterPath(chapterKey: string | null, docId: string) {
  const { toast } = useToast()
  const key = qk.chapterProgress(docId, chapterKey)
  const progress = useApi(key, (signal) => fetchChapterProgress(chapterKey, docId, signal), {
    enabled: Boolean(chapterKey),
  })
  const stages = useMemo(() => doneMap(progress.data?.stages), [progress.data])

  const mark = useApiMutation(
    (v: { chapterKey: string; stage: string }) => updateChapterStage(v.chapterKey, docId, v.stage, { done: true }),
    {
      invalidates: (v) => [qk.chapterProgress(docId, v.chapterKey)],
      onSuccess: (_r, v) => {
        // Announce the flip: the rail's checkmark alone is easy to miss, and "what now?"
        // is the question every stage completion raises.
        const i = PATH_STAGES.findIndex((p) => p.key === v.stage)
        const next = PATH_STAGES[i + 1]
        toast({
          title: `${PATH_STAGES[i]?.label ?? v.stage} complete ✓`,
          description: next ? `Next: ${next.label} — ${next.lead}` : "Chapter path complete.",
        })
      },
    },
  )
  const { fire } = mark
  const lastMark = useRef<{ chapterKey: string; stage: string } | null>(null)

  const markStage = useCallback(
    (stage: string) => {
      if (!chapterKey || stages[stage]) return
      lastMark.current = { chapterKey, stage }
      fire(lastMark.current)
    },
    [chapterKey, stages, fire],
  )
  const retryMark = useCallback(() => {
    if (lastMark.current) fire(lastMark.current)
  }, [fire])

  return {
    stages,
    progress,
    markStage,
    marking: mark.pending,
    markError: mark.error,
    retryMark,
  }
}
