"use client"

import { useEffect, useState } from "react"
import { ArrowRight, CheckCircle2, Circle, PartyPopper, Repeat } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fetchChapterProgress, updateChapterStage } from "@/features/learn/api/chapter"
import { displaySectionTitle, type LearnTreeNode } from "@/features/learn/api/outline"

type LockInPanelProps = {
  scope: string | null
  docId?: string
  nextSection?: LearnTreeNode | null
  onNavigate?: (node: LearnTreeNode) => void
  onDone?: () => void
}

/** The closing stage: confirm the chapter, drop its concepts into spaced review, and point
 *  to what's next. */
export function LockInPanel({ scope, docId, nextSection, onNavigate, onDone }: LockInPanelProps) {
  const [stages, setStages] = useState<Record<string, { done?: boolean; pass?: boolean }>>({})
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    if (!scope) return
    let cancelled = false
    fetchChapterProgress(scope, docId)
      .then((p) => {
        if (cancelled) return
        setStages((p.stages as typeof stages) || {})
        setLocked(!!p.stages?.lockin?.done)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [scope, docId])

  if (!scope) {
    return <p className="p-6 text-sm text-muted-foreground">Open a chapter to wrap it up.</p>
  }

  const skeletonDone = !!stages.skeleton?.done
  const examPass = !!stages.exam?.pass

  const lockIn = () => {
    setLocked(true)
    updateChapterStage(scope, docId, "lockin", { done: true }).catch(() => {})
    onDone?.()
  }

  const Row = ({ ok, label }: { ok: boolean; label: string }) => (
    <p className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-brand" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground/40" />
      )}
      <span className={ok ? "text-foreground/90" : "text-muted-foreground"}>{label}</span>
    </p>
  )

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-2">
        <PartyPopper className="h-4 w-4 text-brand" />
        <span className="text-sm font-medium">Lock it in</span>
      </div>

      <div className="space-y-1.5">
        <Row ok={skeletonDone} label="Skeleton recalled" />
        <Row ok={examPass} label="Chapter exam passed" />
      </div>

      <div className="rounded-lg border bg-card p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Repeat className="h-4 w-4 text-brand" /> Into spaced review
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          This chapter&rsquo;s concepts are now in your review rotation — they&rsquo;ll resurface
          over time so the structure you built stays durable.
        </p>
      </div>

      {nextSection && (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Up next</p>
            <p className="truncate text-sm font-medium">
              {displaySectionTitle(nextSection.label, nextSection.title)}
            </p>
          </div>
          <Button type="button" size="sm" className="shrink-0" onClick={() => onNavigate?.(nextSection)}>
            Continue
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {locked ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-brand/40 bg-brand/10 p-3 animate-in fade-in-0 zoom-in-95 duration-300">
          <PartyPopper className="h-5 w-5 shrink-0 text-brand" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Chapter complete — nice work.</p>
            <p className="text-xs text-muted-foreground">
              Its concepts are in your spaced-review rotation now.
            </p>
          </div>
        </div>
      ) : (
        <Button type="button" onClick={lockIn}>
          Mark chapter complete
        </Button>
      )}
    </div>
  )
}
