"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Compass, ListTree, Loader2, Sparkles, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  countSections,
  fetchOrient,
  updateChapterStage,
  type LearnTreeNode,
  type OrientResponse,
} from "@/lib/learn-service"

type OrientPanelProps = {
  scope: string | null
  docId?: string
  /** The chapter node — used for the "what's ahead" size hint. */
  node?: LearnTreeNode | null
  /** Marks the orient stage acknowledged (the path's soft gate). */
  onAcknowledge?: () => void
}

/** Advance organizer shown before reading: objectives + things to watch for. */
export function OrientPanel({ scope, docId, node, onAcknowledge }: OrientPanelProps) {
  const [data, setData] = useState<OrientResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acked, setAcked] = useState(false)

  useEffect(() => {
    if (!scope) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setAcked(false)
    fetchOrient(scope, docId)
      .then((r) => {
        if (cancelled) return
        if (r.error) setError(r.error)
        else setData(r)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load orientation"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [scope, docId])

  if (!scope) {
    return <p className="p-6 text-sm text-muted-foreground">Open a chapter to see its objectives.</p>
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Setting up your orientation…
      </div>
    )
  }
  if (error) {
    return <p className="p-6 text-sm text-destructive">{error}</p>
  }

  const objectives = data?.objectives ?? []
  const watchFor = data?.watchFor ?? []
  const sectionCount = node ? countSections(node.children) : 0
  const conceptCount = node?.conceptCount ?? 0

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-2">
        <Compass className="h-4 w-4 text-nvidia-green" />
        <span className="text-sm font-medium">Before you start</span>
      </div>

      {(sectionCount > 0 || conceptCount > 0) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>What&rsquo;s ahead:</span>
          {sectionCount > 0 && (
            <span className="flex items-center gap-1.5">
              <ListTree className="h-3.5 w-3.5" />
              {sectionCount} section{sectionCount === 1 ? "" : "s"}
            </span>
          )}
          {conceptCount > 0 && (
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {conceptCount} concept{conceptCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Target className="h-3.5 w-3.5" /> By the end you&rsquo;ll be able to
        </p>
        <ul className="space-y-1.5">
          {objectives.map((o, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-nvidia-green" />
              <span className="text-foreground/90">{o}</span>
            </li>
          ))}
          {objectives.length === 0 && (
            <li className="text-sm text-muted-foreground">No objectives yet — process this chapter first.</li>
          )}
        </ul>
      </div>

      {watchFor.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" /> Watch out for
          </p>
          <ul className="space-y-1.5">
            {watchFor.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70" />
                <span className="text-foreground/90">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t pt-3">
        {acked ? (
          <p className="text-sm text-nvidia-green">Oriented — hit Continue to start learning the chapter.</p>
        ) : (
          <Button
            type="button"
            onClick={() => {
              setAcked(true)
              updateChapterStage(scope, docId, "orient", { done: true }).catch(() => {})
              onAcknowledge?.()
            }}
          >
            Got it — I&rsquo;m oriented
          </Button>
        )}
      </div>
    </div>
  )
}
