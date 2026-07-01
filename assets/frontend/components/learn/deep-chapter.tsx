"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { MarkdownReader } from "@/components/learn/markdown-reader"
import {
  askTextbook,
  fetchDeepChapter,
  prepareDeepChapter,
  recordEngagement,
  type AskResponse,
  type ConceptLesson,
  type DeepChapterResponse,
  type LearnTreeNode,
} from "@/lib/learn-service"
import type { Course } from "@/lib/courses"
import { cn } from "@/lib/utils"

type DeepChapterProps = {
  course: Course
  scope: string | null
  node: LearnTreeNode | null
  /** Top-level chapters, for prev/next navigation without leaving the surface. */
  chapters: LearnTreeNode[]
  onBack: () => void
  onNavigate: (node: LearnTreeNode) => void
}

const KIND_COLOR: Record<string, string> = {
  definition: "text-sky-400 border-sky-400/30 bg-sky-400/10",
  theorem: "text-purple-400 border-purple-400/30 bg-purple-400/10",
  principle: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  result: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  method: "text-rose-400 border-rose-400/30 bg-rose-400/10",
}

// ---------------------------------------------------------------------------
// Inline concept annotation: turn concept-name mentions inside prose into live
// spans (first mention of each name per paragraph/list item, stateless so the
// output is deterministic under re-renders).
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildConceptRegex(concepts: ConceptLesson[]): RegExp | null {
  const names = Array.from(new Set(concepts.map((c) => c.name.trim()).filter((n) => n.length >= 3)))
  if (names.length === 0) return null
  names.sort((a, b) => b.length - a.length)
  return new RegExp(`\\b(${names.map(escapeRegExp).join("|")})\\b`, "gi")
}

function annotateNode(
  children: React.ReactNode,
  regex: RegExp,
  indexByName: Map<string, number>,
  seen: Set<string>,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      const parts: React.ReactNode[] = []
      let last = 0
      regex.lastIndex = 0
      for (let m = regex.exec(child); m; m = regex.exec(child)) {
        const name = m[1].toLowerCase()
        const idx = indexByName.get(name)
        if (idx === undefined || seen.has(name)) continue
        seen.add(name)
        parts.push(child.slice(last, m.index))
        parts.push(
          <button
            key={`${name}-${m.index}`}
            type="button"
            data-concept={idx}
            className="dc-term cursor-pointer rounded-sm border-b border-dotted border-nvidia-green/60 bg-transparent p-0 font-inherit text-inherit hover:bg-nvidia-green/10"
          >
            {m[1]}
          </button>,
        )
        last = m.index + m[1].length
      }
      if (parts.length === 0) return child
      parts.push(child.slice(last))
      return parts
    }
    // Recurse into simple inline elements (em/strong/…) but never into code,
    // links, or KaTeX output — annotating those would corrupt them.
    if (React.isValidElement(child)) {
      const tag = typeof child.type === "string" ? child.type : null
      const cls = String((child.props as { className?: string }).className ?? "")
      if (!tag || ["code", "pre", "a"].includes(tag) || /katex|math/.test(cls)) return child
      const inner = (child.props as { children?: React.ReactNode }).children
      if (inner === undefined) return child
      return React.cloneElement(child, undefined, annotateNode(inner, regex, indexByName, seen))
    }
    return child
  })
}

// ---------------------------------------------------------------------------

function CheckReveal({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
      <div className="font-medium text-foreground/90">Check yourself: {q}</div>
      {open ? (
        <div className="mt-1 text-muted-foreground">{a}</div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 text-nvidia-green hover:underline"
        >
          Reveal answer
        </button>
      )}
    </div>
  )
}

export function DeepChapter({ course, scope, node, chapters, onBack, onNavigate }: DeepChapterProps) {
  const docId = course.learnDocId ?? course.id
  const [data, setData] = useState<DeepChapterResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)

  // Inline concept popover (event-delegated so the reader never re-renders on open/close).
  const [active, setActive] = useState<{ idx: number; x: number; y: number } | null>(null)
  // Select → explain.
  const [selChip, setSelChip] = useState<{ text: string; x: number; y: number } | null>(null)
  const [explain, setExplain] = useState<{ q: string; res: AskResponse | null; loading: boolean } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!scope) return
    setLoading(true)
    setError(null)
    try {
      const d = await fetchDeepChapter(docId, scope)
      setData(d)
      setPreparing(Boolean(d.status?.running))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chapter")
    } finally {
      setLoading(false)
    }
  }, [docId, scope])

  useEffect(() => {
    setData(null)
    setActive(null)
    setSelChip(null)
    setExplain(null)
    load()
    scrollRef.current?.scrollTo({ top: 0 })
  }, [load])

  useEffect(() => {
    if (data?.markdown && scope) recordEngagement("read", scope, docId)
  }, [data?.markdown, scope, docId])

  // Poll while a prepare pass runs so explanations stream in as they finish.
  useEffect(() => {
    if (!preparing) return
    const t = setInterval(async () => {
      if (!scope) return
      try {
        const d = await fetchDeepChapter(docId, scope)
        setData(d)
        if (!d.status?.running) setPreparing(false)
      } catch {
        setPreparing(false)
      }
    }, 6000)
    return () => clearInterval(t)
  }, [preparing, docId, scope])

  const handlePrepare = async () => {
    if (!scope) return
    setPreparing(true)
    try {
      await prepareDeepChapter(docId, scope)
    } catch {
      setPreparing(false)
    }
  }

  const concepts = useMemo(() => data?.concepts ?? [], [data])
  const indexByName = useMemo(() => {
    const m = new Map<string, number>()
    concepts.forEach((c, i) => {
      const k = c.name.trim().toLowerCase()
      if (!m.has(k)) m.set(k, i)
    })
    return m
  }, [concepts])

  // The reader element is memoized: popover/selection state changes must not
  // re-parse a whole chapter of markdown.
  const reader = useMemo(() => {
    if (!data?.markdown) return null
    const regex = buildConceptRegex(concepts)
    const annotate = (children: React.ReactNode) =>
      regex ? annotateNode(children, regex, indexByName, new Set<string>()) : children
    return (
      <MarkdownReader
        content={data.markdown}
        proseSize="base"
        components={
          regex
            ? {
                p: ({ node: _n, children, ...props }) => <p {...props}>{annotate(children)}</p>,
                li: ({ node: _n, children, ...props }) => <li {...props}>{annotate(children)}</li>,
              }
            : undefined
        }
      />
    )
  }, [data?.markdown, concepts, indexByName])

  // Event delegation: clicks on annotated terms open the concept popover in place.
  const handleReaderClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[data-concept]") as HTMLElement | null
    if (el) {
      const idx = Number(el.dataset.concept)
      const r = el.getBoundingClientRect()
      setActive({ idx, x: r.left, y: r.bottom + 6 })
      setSelChip(null)
      e.stopPropagation()
      return
    }
    setActive(null)
  }

  const handleMouseUp = () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ""
    if (!sel || sel.isCollapsed || text.length < 8 || text.length > 600) {
      setSelChip(null)
      return
    }
    const r = sel.getRangeAt(0).getBoundingClientRect()
    setSelChip({ text, x: r.left + r.width / 2, y: r.top - 8 })
  }

  const runExplain = async (text: string) => {
    setSelChip(null)
    const q = `Explain this passage from the book in plain terms: "${text}"`
    setExplain({ q: text, res: null, loading: true })
    try {
      const res = await askTextbook(docId, q)
      setExplain({ q: text, res, loading: false })
    } catch (e) {
      setExplain({
        q: text,
        res: { answer: e instanceof Error ? e.message : "Failed to answer", citations: [] },
        loading: false,
      })
    }
  }

  const chapterIdx = useMemo(
    () => chapters.findIndex((c) => c.sectionKey === scope),
    [chapters, scope],
  )
  const prevChapter = chapterIdx > 0 ? chapters[chapterIdx - 1] : null
  const nextChapter = chapterIdx >= 0 && chapterIdx < chapters.length - 1 ? chapters[chapterIdx + 1] : null

  const briefing = data?.briefing
  const status = data?.status
  const needsPrepare = Boolean(
    status && (!status.briefing || (status.totalConcepts > 0 && status.explained < status.totalConcepts)),
  )
  const activeConcept = active ? concepts[active.idx] : null
  const title = node?.title || node?.label || data?.blocks?.[0]?.heading || "Chapter"

  return (
    <div className="flex h-full flex-col">
      {/* Header — the only chrome; everything else happens on the one surface. */}
      <div className="flex items-center gap-2 border-b bg-card/80 px-3 py-2 backdrop-blur">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
          <ChevronLeft className="h-3.5 w-3.5" />
          {course.title}
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
        {status && status.totalConcepts > 0 && (
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
            deep layer {status.explained}/{status.totalConcepts}
          </span>
        )}
        {preparing ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> preparing…
          </span>
        ) : (
          needsPrepare && (
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={handlePrepare}>
              <Wand2 className="h-3.5 w-3.5" />
              Prepare deep layer
            </Button>
          )
        )}
        <div className="flex items-center gap-1">
          <Button
            type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
            disabled={!prevChapter} onClick={() => prevChapter && onNavigate(prevChapter)}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <Button
            type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
            disabled={!nextChapter} onClick={() => nextChapter && onNavigate(nextChapter)}
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6"
        onClick={handleReaderClick}
        onMouseUp={handleMouseUp}
      >
        <div className="mx-auto max-w-[80ch]">
          {loading && !data && (
            <div className="space-y-3">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
              {error}
              <Button type="button" variant="outline" size="sm" className="ml-3 h-7 text-xs" onClick={load}>
                Retry
              </Button>
            </div>
          )}

          {/* Briefing — what this chapter teaches, assembled from the pre-generated layer. */}
          {briefing && (
            <div className="mb-8 rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" />
                <span>Chapter briefing</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {briefing.objectives.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      You&apos;ll be able to
                    </div>
                    <ul className="space-y-1 text-sm text-foreground/90">
                      {briefing.objectives.map((o, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-nvidia-green">•</span>
                          <span>{o}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {briefing.watchFor.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Watch for
                    </div>
                    <ul className="space-y-1 text-sm text-foreground/90">
                      {briefing.watchFor.map((w, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-amber-400">•</span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {briefing.sections.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    The road through
                  </div>
                  <div className="space-y-1">
                    {briefing.sections.map((s) => (
                      <div key={s.sectionKey} className="text-sm" style={{ paddingLeft: `${(s.depth ?? 0) * 12}px` }}>
                        <span className="text-foreground/90">{s.heading}</span>
                        {s.essence && <span className="text-muted-foreground"> — {s.essence}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {briefing.keyConcepts.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t pt-3">
                  {briefing.keyConcepts.map((c) => {
                    const idx = indexByName.get(c.name.trim().toLowerCase())
                    return (
                      <button
                        key={c.name}
                        type="button"
                        data-concept={idx}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs",
                          KIND_COLOR[c.kind] ?? "border-border text-muted-foreground",
                        )}
                        title={c.signal}
                      >
                        {c.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* The reader spine. */}
          {reader}
        </div>
      </div>

      {/* Concept popover — anchored to the clicked term. */}
      {activeConcept && active && (
        <div
          className="fixed z-50 w-[min(26rem,90vw)] rounded-lg border bg-popover p-3 shadow-xl"
          style={{
            left: Math.min(active.x, window.innerWidth - Math.min(430, window.innerWidth * 0.92)),
            top: Math.min(active.y, window.innerHeight - 320),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{activeConcept.name}</span>
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px]",
                  KIND_COLOR[activeConcept.kind] ?? "border-border text-muted-foreground",
                )}
              >
                {activeConcept.kind}
              </span>
            </div>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setActive(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
            <p className="text-foreground/90">{activeConcept.signal}</p>
            {activeConcept.deepExplanation && (
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
                {activeConcept.deepExplanation}
              </p>
            )}
            {(activeConcept.prereqNames?.length ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground">
                Builds on: <span className="text-foreground/80">{activeConcept.prereqNames!.join(", ")}</span>
              </div>
            )}
            {activeConcept.questions?.[0] && (
              <CheckReveal q={activeConcept.questions[0].q} a={activeConcept.questions[0].a} />
            )}
          </div>
        </div>
      )}

      {/* Select → explain chip. */}
      {selChip && (
        <button
          type="button"
          className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full border bg-popover px-3 py-1 text-xs shadow-lg hover:bg-muted"
          style={{ left: selChip.x, top: selChip.y }}
          onClick={() => runExplain(selChip.text)}
        >
          <Sparkles className="h-3 w-3 text-nvidia-green" />
          Explain this
        </button>
      )}

      {/* Explain drawer — grounded answer over the same surface, reader stays put. */}
      {explain && (
        <div className="fixed bottom-0 right-0 top-12 z-40 w-[min(28rem,95vw)] overflow-y-auto border-l bg-card p-4 shadow-2xl">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">Explain</div>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setExplain(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <blockquote className="mb-3 border-l-2 border-nvidia-green/40 pl-2 text-xs italic text-muted-foreground">
            {explain.q}
          </blockquote>
          {explain.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking with the book…
            </div>
          ) : (
            <>
              <div className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                {explain.res?.answer ?? "No answer."}
              </div>
              {(explain.res?.citations?.length ?? 0) > 0 && (
                <div className="mt-3 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                  {explain.res!.citations.map((c) => (
                    <div key={c.n}>
                      [{c.n}] {c.heading ?? c.sectionKey} {c.page != null ? `· p.${c.page}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
