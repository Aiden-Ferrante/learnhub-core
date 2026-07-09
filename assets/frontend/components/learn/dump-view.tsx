"use client"

import { useMemo, useState } from "react"
import { Brain, ChevronLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  checkRecall,
  displaySectionTitle,
  type LearnTreeNode,
  type RecallResponse,
} from "@/lib/learn-service"

type DumpViewProps = {
  /** Top-level chapters to free-recall (the tree's chapter nodes). */
  chapters: LearnTreeNode[]
  docId?: string
  onBack: () => void
  onDone?: () => void
}

/** Free-recall "brain dump": from memory, write everything you remember about a chapter, then
 *  compare to its concept list — the generation effect, one of the strongest encoders. */
export function DumpView({ chapters, docId, onBack, onDone }: DumpViewProps) {
  const pickable = useMemo(
    () => chapters.filter((c) => c.isSection && c.sectionKey),
    [chapters],
  )
  const [scope, setScope] = useState<string | null>(pickable[0]?.sectionKey ?? null)
  const [text, setText] = useState("")
  const [result, setResult] = useState<RecallResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = () => {
    if (!scope || !text.trim()) return
    setBusy(true)
    setError(null)
    checkRecall(scope, docId, text)
      .then((r) => {
        if (r.error) setError(r.error)
        else {
          setResult(r)
          onDone?.()
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't check your recall"))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to course
        </button>
        <span className="flex items-center gap-2 text-sm font-medium">
          <Brain className="h-4 w-4 text-brand" />
          Free recall
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Close the book and write everything you remember about a chapter from memory — then see
        which concepts you covered and which you missed.
      </p>

      <div className="rounded-lg border bg-card p-6">
        {pickable.length > 1 && (
          <div className="mb-3 flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Chapter</label>
            <select
              value={scope ?? ""}
              onChange={(e) => {
                setScope(e.target.value)
                setResult(null)
                setText("")
              }}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {pickable.map((c) => (
                <option key={c.sectionKey} value={c.sectionKey ?? ""}>
                  {displaySectionTitle(c.label, c.title)}
                </option>
              ))}
            </select>
          </div>
        )}

        {!result ? (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              Close the book. From memory, write everything you remember about this chapter — the
              ideas, terms, how they connect. Don&rsquo;t peek; the struggle is the point.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder="Brain-dump here…"
              className="w-full resize-y rounded-md border bg-background p-3 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-brand/50"
            />
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <Button type="button" className="mt-3" disabled={!text.trim() || busy} onClick={check}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
              Check what I remembered
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{result.coverage}%</span>
              <span className="text-sm text-muted-foreground">
                of {result.total} concepts recalled ({result.covered.length}/{result.total})
              </span>
            </div>

            {result.missed.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-500">
                  Gaps — you didn&rsquo;t mention these
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.missed.map((n) => (
                    <span
                      key={n}
                      className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-xs text-foreground/80"
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.covered.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recalled
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.covered.map((n) => (
                    <span
                      key={n}
                      className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-xs text-foreground/70"
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setResult(null)
                  setText("")
                }}
              >
                Try again
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
