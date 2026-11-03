"use client"

import { CheckCircle2, Circle, PartyPopper, Repeat } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice, qk, roots, useApi, useApiMutation, unwrap } from "@/kit/data"
import { Note } from "@/kit/study"
import { fetchChapterProgress, updateChapterStage } from "@/gateways/api/chapter"
import type { LearnTreeNode } from "@/gateways/api/outline"

type LockInPanelProps = {
  scope: string | null
  docId?: string
  onNavigate?: (node: LearnTreeNode) => void
  onDone?: () => void
}

/** The closing stage: confirm the chapter, drop its concepts into spaced review, and point
 *  to what's next. "Mark chapter complete" is a write: the panel shows the chapter as
 *  complete only once the stage is saved. */
export function LockInPanel({ scope, docId, onDone }: LockInPanelProps) {
  const q = useApi(
    qk.chapterProgress(docId, scope),
    (signal) => unwrap(fetchChapterProgress(scope, docId, signal)),
    { enabled: Boolean(scope) },
  )
  const lock = useApiMutation(() => unwrap(updateChapterStage(scope, docId, "lockin", { done: true })), {
    invalidates: [roots.chapterProgress],
    onSuccess: () => onDone?.(),
  })

  if (!scope) {
    return <p className="p-6 text-sm text-muted-foreground">Open a chapter to wrap it up.</p>
  }

  return (
    <AsyncView q={q} errorTitle="Couldn't load this chapter's progress">
      {(p) => {
        const stages = (p.stages ?? {}) as Record<string, { done?: boolean }>
        const skeletonDone = !!stages.skeleton?.done
        const locked = !!stages.lockin?.done || lock.data !== undefined
        return (
          <div className="space-y-5 p-6">
            <div className="flex items-center gap-2">
              <PartyPopper className="h-4 w-4 text-ink-accent" />
              <span className="text-sm font-medium">Lock it in</span>
            </div>

            <p className="flex items-center gap-2 text-sm">
              {skeletonDone ? (
                <CheckCircle2 className="h-4 w-4 text-ink-accent" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
              <span className={skeletonDone ? "text-foreground/90" : "text-muted-foreground"}>Skeleton recalled</span>
            </p>

            <Note>
              <p className="flex items-center gap-2 text-sm font-medium">
                <Repeat className="h-4 w-4 text-ink-accent" /> Into spaced review
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                This chapter&rsquo;s concepts are now in your review rotation — they&rsquo;ll resurface over time
                so the structure you built stays durable.
              </p>
            </Note>

            {locked ? (
              <Note className="flex items-center gap-2.5">
                <PartyPopper className="h-5 w-5 shrink-0 text-ink-accent" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Chapter complete — nice work.</p>
                  <p className="text-xs text-muted-foreground">Its concepts are in your spaced-review rotation now.</p>
                </div>
              </Note>
            ) : (
              <div className="flex flex-col gap-2">
                <Button type="button" disabled={lock.pending} onClick={() => lock.fire()}>
                  Mark chapter complete
                </Button>
                {lock.error && (
                  <ErrorNotice compact title="Not saved" error={lock.error} onRetry={() => lock.fire()} />
                )}
              </div>
            )}
          </div>
        )
      }}
    </AsyncView>
  )
}
