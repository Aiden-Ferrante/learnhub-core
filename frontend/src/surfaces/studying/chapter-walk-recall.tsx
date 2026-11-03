"use client"

import { useState } from "react"
import { CheckCircle2, RotateCcw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice, type ApiError } from "@/kit/data"
import type { SkeletonGrade } from "@/gateways/api/chapter"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { WALK_GRADES } from "@/surfaces/studying/use-chapter-walk"

/** One recall step of the chapter walk: write the branch's sub-sections from memory,
 *  reveal the real outline, self-grade. The draft persists per branch in localStorage;
 *  mount with `key={ofKey}` so each step loads its own draft. */
export function WalkRecallStep({
  draftKey,
  isFrame,
  heading,
  childKeys,
  nodeFor,
  label,
  essences,
  essencesError,
  onRetryEssences,
  revealed,
  onHide,
  justGraded,
  onGrade,
  pending,
  error,
  onRetry,
}: {
  draftKey: string
  isFrame: boolean
  heading: string
  childKeys: string[]
  nodeFor: (k: string) => LearnTreeNode | null | undefined
  label: (k: string) => string
  essences: Record<string, string>
  essencesError: ApiError | null
  onRetryEssences: () => void
  revealed: boolean
  onHide: () => void
  justGraded: SkeletonGrade | null
  onGrade: (g: SkeletonGrade) => void
  pending: boolean
  error: ApiError | null
  onRetry: () => void
}) {
  const [recall, setRecall] = useState(() => {
    try {
      return localStorage.getItem(draftKey) || ""
    } catch {
      return "" // storage unavailable: start with an empty draft
    }
  })
  const onChange = (v: string) => {
    setRecall(v)
    try {
      localStorage.setItem(draftKey, v)
    } catch {
      /* storage unavailable: the draft just won't survive a reload */
    }
  }

  return (
    <div className="space-y-4 p-6">
      <p className="text-sm text-muted-foreground">
        {isFrame ? (
          "From memory, recall this chapter's main sections — its overall shape."
        ) : (
          <>
            From memory, recall the sub-sections of <span className="font-medium text-foreground">{heading}</span>.
          </>
        )}
      </p>
      {!revealed ? (
        <textarea
          value={recall}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          placeholder={"1. …\n2. …"}
          aria-label="Your recall"
          className="study-input resize-y text-sm leading-relaxed"
        />
      ) : (
        <div className="space-y-4">
          {recall.trim() && (
            <details className="rounded-lg border bg-muted/20 p-3 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Your recall</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-foreground/90">{recall}</pre>
            </details>
          )}
          {essencesError && (
            <ErrorNotice compact title="Couldn't load section summaries" error={essencesError} onRetry={onRetryEssences} />
          )}
          <ul className="space-y-1 text-sm">
            {childKeys.map((k) => {
              const n = nodeFor(k)
              if (!n) return null
              const ess = n.sectionKey ? essences[n.sectionKey] : ""
              return (
                <li key={n.id} className="leading-snug">
                  <span className="font-medium">{label(k)}</span>
                  {ess && <span className="text-muted-foreground"> — {ess}</span>}
                </li>
              )
            })}
          </ul>
          <div className="space-y-2 border-t pt-3">
            {justGraded ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink-accent">
                <CheckCircle2 className="h-4 w-4" />
                Recorded: {WALK_GRADES.find((g) => g.value === justGraded)?.label}
              </p>
            ) : (
              <>
                <p className="text-sm font-medium">How complete was your recall?</p>
                <div className="flex flex-wrap gap-2">
                  {WALK_GRADES.map((g) => (
                    <Button
                      key={g.value}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      className={g.cls}
                      onClick={() => onGrade(g.value)}
                    >
                      {g.label}
                    </Button>
                  ))}
                </div>
                {error && <ErrorNotice compact title="Not saved" error={error} onRetry={onRetry} />}
                <Button type="button" variant="ghost" size="sm" onClick={onHide} className="text-muted-foreground">
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Try again
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
