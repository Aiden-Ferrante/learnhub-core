"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, ChevronDown, ChevronUp, Loader2, Search, Sparkles, Target, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { MarkdownReader } from "@/components/learn/markdown-reader"
import { useInBookFind } from "@/hooks/use-in-book-find"
import { cn } from "@/lib/utils"
import {
  displaySectionTitle,
  fetchReadingGuide,
  fetchReadingPrepareStatus,
  findNodeBySectionKey,
  numberSections,
  numberedSectionTitle,
  prepareReadingGuide,
  recordEngagement,
  type LearnTreeNode,
  type ReadingCheck,
  type ReadingGuideSection,
  type ReadingPrepareStatus,
} from "@/lib/learn-service"
import type { ReadingTheme } from "@/hooks/use-reading-theme"
import type { Measure, ProseSize } from "@/hooks/use-reading-prefs"

type GuidedReaderProps = {
  scope: string | null
  docId?: string
  /** Full syllabus tree — used to label rail sections with the canonical TOC numbers/titles. */
  tree?: LearnTreeNode[]
  theme?: ReadingTheme
  proseSize?: ProseSize
  measure?: Measure
  onConceptStudied?: () => void
}

/** A self-assessed check: question with a revealable model answer. */
function CheckItem({ check }: { check: ReadingCheck }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border bg-background/40 p-3">
      <p className="text-sm font-medium text-foreground">{check.q}</p>
      {open ? (
        <p className="mt-2 border-l-2 border-brand/40 pl-3 text-sm text-muted-foreground">{check.a}</p>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 text-xs font-medium text-brand hover:underline"
        >
          Reveal answer
        </button>
      )}
    </div>
  )
}

/** Guided reading: the book's own text, scaffolded section by section with a focus note up top,
 *  the skeleton position highlighted in a side rail (scroll-spy), and check-yourself questions
 *  after each section. Guidance is authored lazily by the local model; a "Prepare all" fills it. */
export function GuidedReader({
  scope,
  docId,
  tree,
  theme = "dark",
  proseSize = "base",
  measure = "normal",
}: GuidedReaderProps) {
  const [sections, setSections] = useState<ReadingGuideSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [prep, setPrep] = useState<ReadingPrepareStatus | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // Canonical TOC title + tree-relative depth for each of the chapter's sections, so the rail
  // matches the syllabus tree / walk exactly (same numbers, titles, and nesting).
  const railInfo = useMemo(() => {
    const m = new Map<string, { title: string; depth: number }>()
    if (!tree) return m
    const nums = numberSections(tree)
    const chapter = scope ? findNodeBySectionKey(tree, scope) : null
    const roots = chapter ? chapter.children : tree
    const walk = (nodes: LearnTreeNode[], depth: number) => {
      for (const n of nodes) {
        if (n.isSection && n.sectionKey) {
          m.set(n.sectionKey, { title: numberedSectionTitle(nums.get(n.id), n.label, n.title), depth })
        }
        walk(n.children, depth + 1)
      }
    }
    walk(roots, 0)
    return m
  }, [tree, scope])

  // The reader returns one block per heading, and several fine sub-headings can fold onto one
  // canonical section. Collapse the rail to the first block of each canonical section so it shows
  // the same outline as the tree — the full text below still renders every block.
  const railSections = useMemo(() => {
    const seen = new Set<string>()
    const out: ReadingGuideSection[] = []
    for (const s of sections) {
      if (s.sectionKey && !seen.has(s.sectionKey)) {
        seen.add(s.sectionKey)
        out.push(s)
      }
    }
    return out
  }, [sections])
  // Which content blocks start a new canonical section (only these anchor the rail + scroll-spy).
  const isFirstBlock = useMemo(() => {
    const seen = new Set<string>()
    return sections.map((s) => {
      if (!s.sectionKey || seen.has(s.sectionKey)) return false
      seen.add(s.sectionKey)
      return true
    })
  }, [sections])
  const railLabel = (s: ReadingGuideSection) =>
    railInfo.get(s.sectionKey)?.title ?? displaySectionTitle(s.heading)

  const rootRef = useRef<HTMLDivElement>(null)
  const headingRefs = useRef<Map<string, HTMLElement>>(new Map())
  const scrollerRef = useRef<HTMLElement | null>(null)
  const readSetRef = useRef<Set<string>>(new Set())
  const prevActiveRef = useRef<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const backToTop = () =>
    (scrollerRef.current ?? window).scrollTo({ top: 0, behavior: "smooth" })

  // Find-in-chapter over the rendered text (Ctrl/⌘+F intercepted while mounted).
  const contentRef = useRef<HTMLDivElement>(null)
  const find = useInBookFind(contentRef)
  const findInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (find.open) findInputRef.current?.focus()
  }, [find.open])

  // Load the guided structure (text + position + focus + checks). The endpoint also kicks off
  // background authoring of any missing guidance.
  useEffect(() => {
    if (!scope) {
      setSections([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    fetchReadingGuide(scope, docId)
      .then((r) => {
        if (!active) return
        if (r.error) setError(r.error)
        else setSections(r.sections || [])
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Failed to load reading"))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [scope, docId])

  // Authoring status + poll while it runs.
  const loadStatus = () => {
    if (!scope) return
    fetchReadingPrepareStatus(scope, docId)
      .then((s) => !s.error && setPrep(s))
      .catch(() => {})
  }
  useEffect(loadStatus, [scope, docId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!prep?.running) return
    const id = setInterval(loadStatus, 6000)
    return () => clearInterval(id)
  }, [prep?.running]) // eslint-disable-line react-hooks/exhaustive-deps
  // When authoring fills in, re-fetch the guidance so focus/checks appear.
  const lastAuthored = useRef(0)
  useEffect(() => {
    if (prep && prep.authored > lastAuthored.current) {
      lastAuthored.current = prep.authored
      if (scope) fetchReadingGuide(scope, docId).then((r) => !r.error && setSections(r.sections || []))
    }
  }, [prep?.authored]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll-spy: highlight the section currently at the top of the scroll container.
  useEffect(() => {
    const root = rootRef.current
    if (!root || sections.length === 0) return
    let sp: HTMLElement | null = root.parentElement
    while (sp && sp !== document.body) {
      const oy = getComputedStyle(sp).overflowY
      if (oy === "auto" || oy === "scroll") break
      sp = sp.parentElement
    }
    scrollerRef.current = sp
    const onScroll = () => {
      const top = sp ? sp.getBoundingClientRect().top : 0
      let best: string | null = null
      headingRefs.current.forEach((el, key) => {
        if (el.getBoundingClientRect().top - top <= 96) best = key
      })
      setActiveKey(best)
      setScrolled((sp ? sp.scrollTop : window.scrollY) > 600)
      // A section scrolled above the fold counts as read — record it once (engagement tracking).
      const prev = prevActiveRef.current
      if (best && prev && best !== prev && !readSetRef.current.has(prev)) {
        readSetRef.current.add(prev)
        recordEngagement("read", prev, docId)
      }
      prevActiveRef.current = best
    }
    onScroll()
    const target: HTMLElement | Window = sp ?? window
    target.addEventListener("scroll", onScroll, { passive: true })
    return () => target.removeEventListener("scroll", onScroll)
  }, [sections.length, docId])

  const jumpTo = (key: string) => {
    headingRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const runPrepare = () => {
    if (!scope) return
    prepareReadingGuide(scope, docId)
      .then((s) => !s.error && setPrep(s))
      .catch(() => {})
  }

  if (!scope) {
    return <p className="p-6 text-sm text-muted-foreground">Open a chapter to read it.</p>
  }
  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    )
  }
  if (error) {
    return <p className="p-6 text-sm text-destructive">{error}</p>
  }
  if (sections.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No readable text for this chapter yet.</p>
  }

  return (
    <div ref={rootRef} className="flex gap-6 p-4">
      {scrolled && (
        <button
          type="button"
          onClick={backToTop}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-30 flex h-9 w-9 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
      {/* Skeleton rail — your position in the chapter, highlighted as you scroll. */}
      <nav className="sticky top-2 hidden h-fit w-56 shrink-0 self-start lg:block">
        <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          In this chapter
        </p>
        <ul className="space-y-0.5">
          {railSections.map((s) => {
            const info = railInfo.get(s.sectionKey)
            const d = Math.min(info?.depth ?? s.depth ?? 0, 4)
            const isActive = s.sectionKey === activeKey
            const label = info?.title ?? displaySectionTitle(s.heading)
            return (
              <li key={s.sectionKey}>
                <button
                  type="button"
                  onClick={() => jumpTo(s.sectionKey)}
                  style={{ paddingLeft: `${0.25 + d * 0.6}rem` }}
                  className={cn(
                    "block w-full truncate rounded py-1 pr-1 text-left text-xs transition-colors",
                    isActive
                      ? "bg-brand/15 font-medium text-brand"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title={label}
                >
                  {label}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Find toggle + floating find bar (Ctrl/⌘+F also opens it). */}
      {find.supported && !find.open && (
        <button
          type="button"
          onClick={find.openFind}
          aria-label="Find in chapter"
          className="fixed right-6 top-20 z-30 flex h-9 w-9 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
      {find.open && (
        <div className="fixed right-6 top-20 z-40 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1.5 shadow-md">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={findInputRef}
            value={find.query}
            onChange={(e) => find.search(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (e.shiftKey) find.prev()
                else find.next()
              }
            }}
            placeholder="Find in chapter"
            className="w-36 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="min-w-[3.5rem] text-right text-xs tabular-nums text-muted-foreground">
            {find.query ? `${find.count ? find.active + 1 : 0}/${find.count}` : ""}
          </span>
          <button type="button" onClick={find.prev} disabled={find.count === 0} aria-label="Previous match" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40">
            <ChevronUp className="h-4 w-4" />
          </button>
          <button type="button" onClick={find.next} disabled={find.count === 0} aria-label="Next match" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40">
            <ChevronDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={find.close} aria-label="Close find" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* The guided read */}
      <div ref={contentRef} className="min-w-0 flex-1">
        {prep && prep.total > 0 && prep.authored < prep.total && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border bg-card/60 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              {prep.running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-brand" />
              )}
              {prep.running
                ? `Adding focus notes & checks… ${prep.authored}/${prep.total}`
                : `Guidance ready for ${prep.authored}/${prep.total} sections`}
            </span>
            {!prep.running && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={runPrepare}
                title="Author the rest of this chapter's reading guidance now"
              >
                Prepare all
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-8">
          {sections.map((s, i) => (
            <section key={`${s.sectionKey}-${i}`} className="scroll-mt-4">
              {isFirstBlock[i] && (
                <span
                  ref={(el) => {
                    if (el) headingRefs.current.set(s.sectionKey, el)
                    else headingRefs.current.delete(s.sectionKey)
                  }}
                  aria-hidden
                />
              )}

              {/* Focus moment — what to watch for here. */}
              {s.focus && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2">
                  <Target className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <p className="text-sm text-foreground/90">
                    <span className="font-medium text-brand">Focus — </span>
                    {s.focus}
                  </p>
                </div>
              )}

              {/* The book's own text. */}
              <MarkdownReader content={s.markdown} theme={theme} proseSize={proseSize} measure={measure} />

              {/* Check yourself. */}
              {s.checks && s.checks.length > 0 && (
                <div className="mt-4 rounded-lg border bg-muted/20 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <ChevronDown className="h-3.5 w-3.5" />
                    Check yourself
                  </p>
                  <div className="flex flex-col gap-2">
                    {s.checks.map((c, i) => (
                      <CheckItem key={i} check={c} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
