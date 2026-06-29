"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlignLeft,
  CheckCircle2,
  Circle,
  FileText,
  Highlighter,
  ListChecks,
  Loader2,
  Sparkles,
  StickyNote,
  Target,
  Trash2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useReadSections } from "@/hooks/use-read-sections"
import { useTextAnnotations } from "@/hooks/use-text-annotations"
import { MarkdownReader } from "@/components/learn/markdown-reader"
import { ConceptMarkdown } from "@/components/learn/concept-markdown"
import { ConceptMasteryDot } from "@/components/learn/concept-mastery-dot"
import { InlineCheck } from "@/components/learn/inline-check"
import { KIND_STYLES } from "@/components/learn/concept-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  fetchConceptMastery,
  fetchSectionAugment,
  fetchSectionConcepts,
  fetchSectionContent,
  submitReviewGrade,
  type ConceptLesson,
  type ConceptMasteryResponse,
  type SectionAugment,
} from "@/lib/learn-service"
import { useConceptHighlights } from "@/hooks/use-concept-highlights"
import type { ReadingTheme } from "@/hooks/use-reading-theme"
import type { Measure, ProseSize } from "@/hooks/use-reading-prefs"

type SectionReaderProps = {
  scope: string | null
  /** Learn-service document id (content namespace) — falls back to the latest converted doc. */
  docId?: string
  theme?: ReadingTheme
  proseSize?: ProseSize
  measure?: Measure
  /** Called after a concept is graded from the in-text popover (to refresh mastery). */
  onConceptStudied?: () => void
}

/** Reads a section's source notes (markdown). Extracted concepts' source sentences are
 *  highlighted inline — click one to study it. */
export function SectionReader({
  scope,
  docId,
  theme = "dark",
  proseSize = "sm",
  measure = "normal",
  onConceptStudied,
}: SectionReaderProps) {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [concepts, setConcepts] = useState<ConceptLesson[]>([])
  const [mastery, setMastery] = useState<ConceptMasteryResponse["byConcept"]>({})
  const [active, setActive] = useState<ConceptLesson | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [augment, setAugment] = useState<SectionAugment | null>(null)
  const [augLoading, setAugLoading] = useState(false)
  const [mode, setMode] = useState<"deep" | "skim">("deep")
  const contentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!scope) {
      setMarkdown(null)
      setConcepts([])
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setActive(null)
    Promise.all([
      fetchSectionContent(scope, docId),
      fetchSectionConcepts(scope, docId).catch(() => null),
      fetchConceptMastery(docId).catch(() => null),
    ])
      .then(([data, cs, m]) => {
        if (cancelled) return
        if (data.error) setError(data.error)
        else setMarkdown(data.markdown)
        if (cs && !cs.error) setConcepts(cs.concepts || [])
        if (m && !m.error) setMastery(m.byConcept || {})
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load notes")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scope, docId])

  // Augmentation (LLM objectives + recap) loads separately so the slow first generation
  // doesn't block the reader from showing.
  useEffect(() => {
    if (!scope) {
      setAugment(null)
      return
    }
    let cancelled = false
    setAugment(null)
    setAugLoading(true)
    setMode("deep")
    fetchSectionAugment(scope, docId)
      .then((a) => !cancelled && !a.error && setAugment(a))
      .catch(() => {})
      .finally(() => !cancelled && setAugLoading(false))
    return () => {
      cancelled = true
    }
  }, [scope, docId])

  const onConceptClick = useCallback(
    (key: string) => setActive(concepts.find((c) => c.conceptKey === key) || null),
    [concepts],
  )
  const { hover, count } = useConceptHighlights(contentRef, concepts, onConceptClick)
  const { isRead, toggle } = useReadSections(docId)
  const ann = useTextAnnotations(contentRef, docId, scope)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)

  const grade = (g: 1 | 3) => {
    if (active?.conceptKey) {
      submitReviewGrade(active.conceptKey, g, docId).catch(() => {})
      onConceptStudied?.()
    }
    setActive(null)
  }

  if (!scope) {
    return <p className="p-6 text-sm text-muted-foreground">Select a section to read its notes.</p>
  }
  if (loading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-2 p-6 text-sm">
        <p className="text-destructive">{error}</p>
        <p className="text-muted-foreground">
          Notes are saved when a document is converted. Re-upload this course's PDF to generate them.
        </p>
      </div>
    )
  }
  if (!markdown?.trim()) {
    return (
      <div className="flex flex-col items-center gap-2 p-10 text-center">
        <FileText className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">No notes for this section yet</p>
        <p className="text-sm text-muted-foreground">
          The source text wasn't aligned to this heading. Try the full book reader, or re-convert the
          document.
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/80 px-6 py-1.5 text-xs backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setMode("deep")}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5",
                mode === "deep" ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <AlignLeft className="h-3 w-3" /> Read
            </button>
            <button
              type="button"
              onClick={() => setMode("skim")}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5",
                mode === "skim" ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <ListChecks className="h-3 w-3" /> Skim
            </button>
          </div>
          {count > 0 && mode === "deep" && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Sparkles className="h-3 w-3 text-nvidia-green" />
              {count} highlighted · click to study
            </span>
          )}
        </div>
        {scope && (
          <button
            type="button"
            onClick={() => toggle(scope)}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
              isRead(scope) ? "text-nvidia-green" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {isRead(scope) ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            {isRead(scope) ? "Read" : "Mark read"}
          </button>
        )}
      </div>

      {/* Learning objectives (LLM-generated) */}
      {(augLoading || (augment && augment.objectives.length > 0)) && (
        <div className="border-b bg-nvidia-green/5 px-6 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-nvidia-green">
            <Target className="h-3.5 w-3.5" /> Learning objectives
          </div>
          {augLoading && !augment ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating objectives…
            </div>
          ) : (
            <ul className="space-y-1">
              {augment!.objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nvidia-green/70" />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Deep read (kept mounted so concept highlights persist across the Skim toggle) */}
      <div ref={contentRef} className={mode === "skim" ? "hidden" : ""}>
        <MarkdownReader
          content={markdown}
          className="p-6"
          theme={theme}
          proseSize={proseSize}
          measure={measure}
        />
      </div>

      {/* Skim — concepts only, with mastery */}
      {mode === "skim" && (
        <div className="flex flex-col gap-2 p-6">
          {concepts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No concepts extracted for this section.</p>
          ) : (
            concepts.map((c, i) => {
              const m = c.conceptKey ? mastery[c.conceptKey] : undefined
              return (
                <div key={i} className="rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ConceptMasteryDot mastery={m?.mastery} attempts={m?.attempts} />
                    <span className="text-sm font-medium">{c.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                        KIND_STYLES[c.kind] || "bg-muted text-muted-foreground"
                      }`}
                    >
                      {c.kind}
                    </span>
                  </div>
                  <ConceptMarkdown content={c.signal} className="mt-1 text-sm text-muted-foreground" />
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Recap (LLM-generated) */}
      {augment && augment.recap && (
        <div className="border-t bg-muted/30 px-6 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Recap
          </div>
          <ConceptMarkdown content={augment.recap} className="text-sm" />
        </div>
      )}

      {/* Consolidate — an inline check from this section's concepts */}
      {concepts.length > 0 && (
        <InlineCheck scope={scope} docId={docId} onAnswered={onConceptStudied} />
      )}

      {/* Glossary hover — name + kind + definition */}
      {hover && !active && (
        <div
          className="pointer-events-none fixed z-50 w-64 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: hover.x, top: hover.y - 8 }}
        >
          <div>
            <span className="font-medium">{hover.name}</span>
            <span className="ml-1 text-muted-foreground">· {hover.kind}</span>
          </div>
          {hover.signal && <div className="mt-0.5 text-muted-foreground">{hover.signal}</div>}
        </div>
      )}

      {/* Click-to-study popover */}
      {active && (
        <div className="absolute bottom-4 right-4 z-20 w-72 rounded-lg border bg-card p-3 shadow-xl">
          <div className="flex items-start gap-2">
            <span className="flex flex-1 flex-wrap items-center gap-2">
              <span className="font-medium">{active.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                  KIND_STYLES[active.kind] || "bg-muted text-muted-foreground"
                }`}
              >
                {active.kind}
              </span>
            </span>
            <button onClick={() => setActive(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ConceptMarkdown content={active.signal} className="mt-2 text-sm text-muted-foreground" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
              onClick={() => grade(1)}
            >
              Review later
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => grade(3)}
            >
              Got it
            </Button>
          </div>
        </div>
      )}

      {/* Selection toolbar — highlight or note the selected passage */}
      {ann.toolbar && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: ann.toolbar.x, top: ann.toolbar.y - 8 }}
        >
          {noteDraft === null ? (
            <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md">
              <button
                className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
                onClick={() => ann.add(ann.toolbar!.text)}
              >
                <Highlighter className="h-3.5 w-3.5 text-amber-400" /> Highlight
              </button>
              <button
                className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
                onClick={() => setNoteDraft("")}
              >
                <StickyNote className="h-3.5 w-3.5 text-nvidia-green" /> Note
              </button>
              <button
                className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
                onClick={() => {
                  navigator.clipboard?.writeText(ann.toolbar!.text).catch(() => {})
                  ann.setToolbar(null)
                }}
              >
                Copy
              </button>
            </div>
          ) : (
            <div className="w-64 rounded-lg border bg-popover p-2 shadow-md">
              <textarea
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Your note…"
                className="h-16 w-full resize-none rounded border bg-background p-1.5 text-xs outline-none"
              />
              <div className="mt-1 flex justify-end gap-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setNoteDraft(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    ann.add(ann.toolbar!.text, noteDraft.trim() || undefined)
                    setNoteDraft(null)
                  }}
                >
                  Save note
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Saved-highlight popover — show its note + remove */}
      {ann.activeNote && (
        <div
          className="fixed z-50 w-60 -translate-x-1/2 rounded-lg border bg-card p-3 shadow-xl"
          style={{ left: ann.activeNote.x, top: ann.activeNote.y + 10 }}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {ann.activeNote.ann.note ? (
                <span className="text-foreground">{ann.activeNote.ann.note}</span>
              ) : (
                "Highlight"
              )}
            </p>
            <button
              onClick={() => ann.setActiveNote(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 h-7 gap-1 px-2 text-xs text-rose-400 hover:bg-rose-500/10"
            onClick={() => ann.remove(ann.activeNote!.ann.id)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        </div>
      )}
    </div>
  )
}
