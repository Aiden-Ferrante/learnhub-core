"use client"

/** What one chapter build produced: the per-section extraction outcomes, then the
 *  concepts it extracted, inspectable and cullable in place. */

import { useMemo, useState } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { cn } from "@/kit/lib/utils"
import { deleteConcept, fetchSectionConcepts } from "@/gateways/api/concepts"
import type { ChapterBuildJob } from "@/gateways/api/pipeline"
import { AsyncView, ErrorNotice, qk, roots, useApi, useApiMutation } from "@/kit/data"

/** The receipt's payload: what was actually extracted. Junk concepts die here in one tap
 *  instead of surviving into reviews. */
function ConceptReceipt({ docId, scope }: { docId: string; scope: string }) {
  const q = useApi(qk.sectionConcepts(docId, scope), (signal) => fetchSectionConcepts(scope, docId, signal))
  // The concept whose delete is in flight, for its row's spinner (one at a time: the
  // buttons disable while a delete runs).
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const remove = useApiMutation((key: string) => deleteConcept(key), {
    // A deleted concept also drops its review history, so every count that read it moves.
    invalidates: [roots.sectionConcepts, roots.concepts, roots.reviewQueue, roots.studyDebt, roots.mastery],
  })

  return (
    <div className="space-y-1 border-t px-3 py-2">
      <AsyncView
        q={q}
        error="inline"
        errorTitle="Couldn't load the concepts"
        skeleton={<p className="text-micro text-muted-foreground">Loading concepts…</p>}
        isEmpty={(d) => d.concepts.length === 0}
        empty={<p className="text-micro text-muted-foreground">No concepts in this chapter.</p>}
      >
        {(d) => (
          <>
            <div className="text-micro font-medium text-muted-foreground">
              Extracted concepts · {d.concepts.length}
            </div>
            {remove.error && (
              <ErrorNotice compact title="Not deleted" error={remove.error} onRetry={() => busyKey && remove.fire(busyKey)} />
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {d.concepts.map((c) => {
                const busy = remove.pending && busyKey === c.conceptKey
                return (
                  <div key={c.conceptKey ?? c.name} className="flex items-start gap-2 text-micro">
                    <span className="mt-0.5 shrink-0 rounded bg-muted px-1 py-px text-muted-foreground">
                      {c.kind}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className="text-muted-foreground"> — {c.signal}</span>
                    </span>
                    {c.conceptKey && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-ink-danger"
                        title="Delete this concept (also removes its review history)"
                        aria-label={`Delete ${c.name}`}
                        disabled={remove.pending}
                        onClick={() => {
                          setBusyKey(c.conceptKey!)
                          remove.fire(c.conceptKey!)
                        }}
                      >
                        {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </AsyncView>
    </div>
  )
}

function outcomeNote(o: NonNullable<ChapterBuildJob["outcomes"]>[number]): string | undefined {
  if (o.status === "skipped") return o.reason
  if (o.status === "empty") return o.gated ? `all ${o.gated} gated` : o.raw ? "model kept none" : "model returned none"
  return o.error?.slice(0, 60)
}

export function OutcomeReport({ job, docId }: { job: ChapterBuildJob; docId: string }) {
  const outcomes = useMemo(() => job.outcomes ?? [], [job.outcomes])
  const counts = useMemo(() => {
    const c = { ok: 0, empty: 0, error: 0, skipped: 0, gated: 0, chunked: 0 }
    for (const o of outcomes) {
      if (o.status === "ok") c.ok++
      else if (o.status === "empty") c.empty++
      else if (o.status === "error") c.error++
      else if (o.status === "skipped") c.skipped++
      if (o.gated) c.gated += o.gated
      if (o.chunks) c.chunked++
    }
    return c
  }, [outcomes])

  if (!outcomes.length) {
    return (
      <div>
        <p className="px-3 py-2 text-micro text-muted-foreground">
          No extraction report — this build only refreshed the deep overlay (concepts already existed).
        </p>
        <ConceptReceipt docId={docId} scope={job.scope} />
      </div>
    )
  }
  const noteworthy = outcomes.filter((o) => o.status !== "ok")
  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap gap-3 text-micro text-muted-foreground">
        <span className="text-ink-accent">{counts.ok} extracted</span>
        {counts.empty > 0 && <span>{counts.empty} empty</span>}
        {counts.skipped > 0 && <span>{counts.skipped} skipped</span>}
        {counts.error > 0 && <span className="text-ink-danger">{counts.error} errors</span>}
        {counts.gated > 0 && <span className="text-ink-warn">{counts.gated} gated (ungrounded)</span>}
        {counts.chunked > 0 && <span>{counts.chunked} chunked (oversize)</span>}
      </div>
      {noteworthy.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {noteworthy.map((o, i) => (
            <div key={`${o.sectionKey}-${i}`} className="flex items-start gap-2 text-micro">
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  o.status === "error" ? "bg-destructive" : o.status === "empty" ? "bg-status-due" : "bg-muted-foreground/50",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-foreground" title={o.heading}>
                {o.heading}
              </span>
              <span className="shrink-0 text-muted-foreground">{outcomeNote(o)}</span>
            </div>
          ))}
        </div>
      )}
      <ConceptReceipt docId={docId} scope={job.scope} />
    </div>
  )
}
