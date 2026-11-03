"use client"

import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice, GRADE_INVALIDATES, qk, useApi, useApiMutation, unwrap } from "@/kit/data"
import { Sheet } from "@/kit/study"
import { EmptyState } from "@/kit/patterns/empty-state"
import { KIND_BADGE, ConceptMarkdown } from "@/surfaces/concepts"
import { fetchSectionConcepts } from "@/gateways/api/concepts"
import { submitReviewGrade } from "@/gateways/api/review"

/** Guided walkthrough: step a section's concepts in order, read each, then self-check —
 *  "Got it" (grade Good) or "Needs review" (grade Again) feeds the spaced-repetition
 *  schedule. The step advances only once the grade is saved. */
export function LessonPanel({
  scope,
  docId,
  onAnswered,
}: {
  scope: string | null
  docId?: string
  onAnswered?: () => void
}) {
  const q = useApi(
    qk.sectionConcepts(docId, scope ?? ""),
    (signal) => unwrap(fetchSectionConcepts(scope ?? "", docId, signal)),
    { enabled: Boolean(scope) },
  )
  // The position belongs to one scope: switching section starts the lesson from the top.
  const [at, setAt] = useState<{ scope: string | null; idx: number }>({ scope, idx: 0 })
  const idx = at.scope === scope ? at.idx : 0
  const next = () => setAt((cur) => ({ scope, idx: (cur.scope === scope ? cur.idx : 0) + 1 }))

  const [last, setLast] = useState<{ key: string; gotIt: boolean } | null>(null)
  const mark = useApiMutation(
    (v: { key: string; gotIt: boolean }) => unwrap(submitReviewGrade(v.key, v.gotIt ? 3 : 1, docId)),
    {
      invalidates: GRADE_INVALIDATES,
      onSuccess: () => {
        next()
        onAnswered?.()
      },
    },
  )

  if (!scope) return <p className="p-4 text-sm text-muted-foreground">Select a section to study.</p>

  return (
    <AsyncView
      q={q}
      errorTitle="Couldn't load this lesson"
      isEmpty={(d) => (d.concepts ?? []).length === 0}
      empty={<EmptyState title="No concepts yet" description="No concepts extracted for this section yet." />}
    >
      {(d) => {
        const concepts = d.concepts ?? []
        const c = concepts[idx]
        if (!c) {
          return (
            <EmptyState
              title={`Lesson complete — ${concepts.length} concepts.`}
              action={
                <Button variant="outline" size="sm" onClick={() => setAt({ scope, idx: 0 })}>
                  Start over
                </Button>
              }
            />
          )
        }
        const onMark = (gotIt: boolean) => {
          if (!c.conceptKey) return next() // nothing to schedule: just move on
          const v = { key: c.conceptKey, gotIt }
          setLast(v)
          mark.fire(v)
        }
        return (
          <div className="flex h-full flex-col gap-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Lesson</span>
              <span className="tabular-nums">
                {idx + 1} / {concepts.length}
              </span>
            </div>

            <Sheet as="article" className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{c.name}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-micro font-medium uppercase ${KIND_BADGE[c.kind] || "bg-muted text-muted-foreground"}`}
                >
                  {c.kind}
                </span>
              </div>
              <ConceptMarkdown content={c.signal} className="text-sm" />
              {c.source && (
                <div className="border-l-2 border-muted pl-3 text-xs italic text-muted-foreground">
                  <ConceptMarkdown content={c.source} />
                </div>
              )}
            </Sheet>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={mark.pending}
                className="border-destructive/40 text-ink-danger hover:bg-destructive/10"
                onClick={() => onMark(false)}
              >
                Needs review
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={mark.pending}
                className="border-status-mastered/40 text-ink-ok hover:bg-status-mastered/10"
                onClick={() => onMark(true)}
              >
                Got it
              </Button>
            </div>
            {mark.error && (
              <ErrorNotice compact title="Not saved" error={mark.error} onRetry={() => last && mark.fire(last)} />
            )}
          </div>
        )
      }}
    </AsyncView>
  )
}
