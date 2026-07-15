"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { KIND_STYLES } from "@/features/learn/components/concepts/concept-card"
import { ConceptMarkdown } from "@/features/learn/components/concepts/concept-markdown"
import {
  fetchSectionConcepts,
  submitReviewGrade,
  type ConceptLesson,
} from "@/features/learn/api"

/** Guided walkthrough: step a section's concepts in order, read each, then self-check —
 *  "Got it" (grade Good) or "Needs review" (grade Again) feeds the spaced-repetition schedule. */
export function LessonPanel({
  scope,
  docId,
  onAnswered,
}: {
  scope: string | null
  docId?: string
  onAnswered?: () => void
}) {
  const [concepts, setConcepts] = useState<ConceptLesson[]>([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!scope) {
      setConcepts([])
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    setIdx(0)
    fetchSectionConcepts(scope, docId)
      .then((res) => {
        if (!active) return
        if (res.error) setError(res.error)
        else setConcepts(res.concepts || [])
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [scope, docId])

  const c = concepts[idx]

  const mark = useCallback(
    (gotIt: boolean) => {
      if (c?.conceptKey) {
        submitReviewGrade(c.conceptKey, gotIt ? 3 : 1, docId).catch(() => {})
        onAnswered?.()
      }
      setIdx((i) => i + 1)
    },
    [c, docId, onAnswered],
  )

  if (!scope) return <p className="p-4 text-sm text-muted-foreground">Select a section to study.</p>
  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading lesson…</p>
  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>
  if (concepts.length === 0)
    return (
      <div className="m-4 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        No concepts extracted for this section yet.
      </div>
    )

  if (!c) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm font-medium">Lesson complete — {concepts.length} concepts.</p>
        <Button variant="outline" size="sm" onClick={() => setIdx(0)}>
          Start over
        </Button>
      </div>
    )
  }

  const kindClass = KIND_STYLES[c.kind] || "bg-muted text-muted-foreground"

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Lesson</span>
        <span className="tabular-nums">
          {idx + 1} / {concepts.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 rounded-lg border bg-card p-5">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">{c.name}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${kindClass}`}>
            {c.kind}
          </span>
        </div>
        <ConceptMarkdown content={c.signal} className="text-sm" />
        {c.source && (
          <div className="border-l-2 border-muted pl-3 text-xs italic text-muted-foreground">
            <ConceptMarkdown content={c.source} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
          onClick={() => mark(false)}
        >
          Needs review
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
          onClick={() => mark(true)}
        >
          Got it
        </Button>
      </div>
    </div>
  )
}
