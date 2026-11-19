"use client"

/** TRIAL (v0.31.5): read a chapter one step at a time, from the chapter path.
 *
 *  Human decisions 2026-11-19: laptop first; concepts are tap-to-reveal (no margin notes);
 *  "Check understanding" closes each step and is optional, with Skip. One slim toolbar, a
 *  ~68-character serif column, the step's title once, source tags quieted to small markers.
 *
 *  Content is the section scope of the existing guided-reading API (markdown + concepts), so
 *  this changes how a step reads, not what is in it. */

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { Components } from "react-markdown"
import { fetchGuidedReading } from "@/gateways/api/chapter"
import type { ConceptLesson } from "@/gateways/api/concepts"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { qk, useApi } from "@/kit/data"
import { cn } from "@/kit/lib/utils"
import { MarkdownReader } from "@/surfaces/reading/markdown-reader"
import { ReviewPanel } from "@/surfaces/studying"

const SIZES = [
  { label: "A", className: "text-[18px]" },
  { label: "A+", className: "text-[20px]" },
] as const
const SIZE_KEY = "lh-step-reader-size"
const SOURCE_TAG = /\[((?:pp?\.|v\d{2}\.|beyond)[^\]]*)\]/g

export type Step = { node: LearnTreeNode; title: string }

/** Drop the section's own heading (the toolbar names the step), quiet the provenance lines
 *  ("*Topics List … · [pp.11–92 · v06.03]*") and turn inline source tags into marker links. */
function prepare(markdown: string): string {
  const lines = markdown.split("\n")
  if (/^#{1,3}\s/.test(lines[0] ?? "")) lines.shift()
  return lines
    .map((l) => (/^\*Topics List\b.*\*$/.test(l.trim()) ? `> ${l.trim().replace(/^\*|\*$/g, "")}` : l))
    .join("\n")
    .replace(SOURCE_TAG, (_m, tag: string) => `[${tag}](#src)`)
}

const norm = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, " ").trim().replace(/s\b/g, "")

/** Find the concept a bold term names: exact (plural-insensitive), else a concept whose name
 *  starts with the term ("K-means" → "K-means algorithm"), else one the term starts with. */
function useConceptIndex(concepts: ConceptLesson[]) {
  return useMemo(() => {
    const list = concepts.map((c) => ({ c, n: norm(c.name) }))
    return (term: string): ConceptLesson | undefined => {
      if (/:\s*$/.test(term)) return undefined // labels like "Step 1:" are not concepts
      const t = norm(term)
      if (t.length < 3 || t.split(" ").length > 5) return undefined
      return (
        list.find((x) => x.n === t)?.c ??
        list.find((x) => x.n.startsWith(`${t} `))?.c ??
        list.find((x) => t.startsWith(`${x.n} `) || t === x.n)?.c
      )
    }
  }, [concepts])
}

/** All the text inside rendered markdown children (for deciding how to render a block). */
function nodeText(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children)
  if (Array.isArray(children)) return children.map(nodeText).join("")
  if (children && typeof children === "object" && "props" in children) {
    return nodeText((children as { props: { children?: React.ReactNode } }).props.children)
  }
  return ""
}

function textOf(children: React.ReactNode): string {
  if (typeof children === "string") return children
  if (Array.isArray(children)) return children.map(textOf).join("")
  return ""
}

/** A bold term that names one of the step's concepts: tap to reveal its meaning. */
const WIDE = "(min-width: 1024px)"

/** On a laptop a tapped term opens in the concepts panel; on a narrow screen, in a popover. */
function ConceptTerm({
  concept,
  onPick,
  children,
}: {
  concept: ConceptLesson
  onPick: (c: ConceptLesson) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => (window.matchMedia(WIDE).matches ? onPick(concept) : setOpen((v) => !v))}
        aria-expanded={open}
        className="cursor-pointer font-semibold text-foreground underline decoration-primary/60 decoration-dotted underline-offset-4 hover:decoration-primary"
      >
        {children}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-20 mt-2 block w-[min(26rem,80vw)] rounded-lg border border-border bg-card p-3 font-sans text-sm font-normal leading-relaxed text-foreground shadow-lg">
          <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{concept.kind}</span>
          {concept.signal}
        </span>
      )}
    </span>
  )
}

export function StepReader({
  docId,
  chapterNumber,
  chapterTitle,
  steps,
  index,
  stepHref,
  pathHref,
  onOpen,
}: {
  docId: string
  chapterNumber?: string
  chapterTitle: string
  steps: Step[]
  index: number
  stepHref: (i: number) => string
  pathHref: string
  onOpen: (sectionKey: string) => void
}) {
  const step = steps[index]
  const key = step.node.sectionKey!
  const q = useApi(qk.guidedReading(docId, key), (signal) => fetchGuidedReading(docId, key, signal))
  const concepts = useMemo(() => q.data?.concepts ?? [], [q.data])
  const index_ = useConceptIndex(concepts)
  const [size, setSize] = useState(0)
  const [check, setCheck] = useState<"offer" | "open" | "skipped">("offer")
  const [picked, setPicked] = useState<string | null>(null)
  const pick = (c: ConceptLesson) => {
    setPicked(c.name)
    requestAnimationFrame(() =>
      document.getElementById(`concept-${c.name}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    )
  }

  useEffect(() => {
    const v = Number(localStorage.getItem(SIZE_KEY) ?? 0)
    setSize(v === 1 ? 1 : 0)
  }, [])
  useEffect(() => {
    onOpen(key)
    setPicked(null)
    // "Check understanding" on the path links here with #check: open the check at once.
    if (window.location.hash === "#check") {
      setCheck("open")
      requestAnimationFrame(() => document.getElementById("check")?.scrollIntoView({ block: "start" }))
    } else {
      setCheck("offer")
      window.scrollTo({ top: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per step
  }, [key])

  const components: Components = useMemo(
    () => ({
      strong: ({ children }) => {
        const c = index_(textOf(children))
        return c ? (
          <ConceptTerm concept={c} onPick={pick}>
            {children}
          </ConceptTerm>
        ) : (
          <strong>{children}</strong>
        )
      },
      a: ({ href, children }) =>
        href === "#src" ? (
          <sup className="mx-0.5 align-super font-sans text-[10px] text-muted-foreground/70 no-underline">{children}</sup>
        ) : (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      // Only the provenance lines (made into quotes by prepare()) are quieted; the book's own
      // quote blocks ("Check yourself", "Important") read normally.
      blockquote: ({ children }) =>
        /^\s*Topics List\b/.test(nodeText(children)) ? (
          <div className="not-prose my-4 font-sans text-xs text-muted-foreground/80 [&_p]:m-0">{children}</div>
        ) : (
          <blockquote>{children}</blockquote>
        ),
    }),
    [index_],
  )

  const next = index + 1 < steps.length ? index + 1 : null
  const prev = index > 0 ? index - 1 : null
  const markdown = useMemo(() => prepare(q.data?.markdown ?? ""), [q.data])

  return (
    <div className="pb-24">
      <div className="sticky top-[var(--fleet-header-h)] z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[calc(62ch+24rem)] items-center gap-4 px-4 py-2.5 text-meta">
          <Link href={pathHref} className="shrink-0 text-muted-foreground hover:text-foreground">
            ← {chapterNumber ? `Chapter ${chapterNumber}` : chapterTitle}
          </Link>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Step {index + 1} of {steps.length}
          </span>
          <div className="flex shrink-0 items-center gap-1" aria-label="Steps">
            {steps.map((s, i) => (
              <Link
                key={s.node.id}
                href={stepHref(i)}
                aria-label={`Step ${i + 1}: ${s.title}`}
                className={cn("h-1.5 w-5 rounded-full", i === index ? "bg-primary" : i < index ? "bg-foreground/40" : "bg-muted")}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const v = size === 0 ? 1 : 0
              setSize(v)
              localStorage.setItem(SIZE_KEY, String(v))
            }}
            className="shrink-0 rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Text size"
          >
            {SIZES[size === 0 ? 1 : 0].label}
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-[calc(62ch+24rem)] items-start gap-12 px-4 lg:grid-cols-[minmax(0,62ch)_20rem]">
      <article className="min-w-0 pt-10">
        <p className="mb-2 font-sans text-xs uppercase tracking-widest text-muted-foreground">
          {chapterNumber ? `Chapter ${chapterNumber} · ` : ""}Step {index + 1}
        </p>
        <h1 className="m-0 mb-8 font-serif text-[34px] font-semibold leading-tight">{step.title}</h1>

        {q.status === "loading" && !q.data ? (
          <p className="text-muted-foreground">Loading this step…</p>
        ) : q.error && !q.data ? (
          <p className="text-ink-warn">Couldn&apos;t load this step. {String(q.error.message ?? "")}</p>
        ) : (
          <MarkdownReader
            content={markdown}
            measure="narrow"
            proseSize="lg"
            components={components}
            className={cn(
              "max-w-none font-serif leading-[1.75]",
              SIZES[size].className,
              "prose-p:text-foreground prose-li:text-foreground",
              "prose-headings:font-serif prose-h3:mt-12 prose-h3:text-[1.3em] prose-h4:text-[1.1em]",
              // Long display equations scroll inside their own box, never the page.
              "[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1",
              "[&_.katex]:inline-block [&_.katex]:max-w-full [&_.katex]:overflow-x-auto [&_.katex]:overflow-y-hidden [&_.katex]:align-middle",
            )}
          />
        )}

        <section id="check" className="mt-16 scroll-mt-24 rounded-2xl border border-border bg-card p-6 font-sans">
          {check === "open" ? (
            <>
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-lg font-semibold">Check understanding</h2>
                <button
                  type="button"
                  onClick={() => setCheck("skipped")}
                  className="text-meta text-muted-foreground hover:text-foreground"
                >
                  Done
                </button>
              </div>
              <ReviewPanel scope={key} docId={docId} />
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">End of step {index + 1}</p>
              <h2 className="mt-1 text-lg font-semibold">
                {check === "skipped" ? "Ready for the next step" : `Check your understanding · ${concepts.length} concepts`}
              </h2>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {check === "offer" && concepts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCheck("open")}
                    className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    Check understanding
                  </button>
                )}
                {next != null ? (
                  <Link
                    href={stepHref(next)}
                    className={cn(
                      "rounded-lg px-4 py-2.5 text-sm font-semibold",
                      check === "offer" && concepts.length > 0
                        ? "border border-border text-muted-foreground hover:text-foreground"
                        : "bg-primary text-primary-foreground",
                    )}
                  >
                    {check === "offer" && concepts.length > 0 ? "Skip · next step →" : `Next: ${steps[next].title} →`}
                  </Link>
                ) : (
                  <Link
                    href={pathHref}
                    className={cn(
                      "rounded-lg px-4 py-2.5 text-sm font-semibold",
                      check === "offer" && concepts.length > 0 ? "border border-border" : "bg-primary text-primary-foreground",
                    )}
                  >
                    {check === "offer" && concepts.length > 0 ? "Skip · back to the chapter" : "Back to the chapter exam"}
                  </Link>
                )}
              </div>
            </>
          )}
        </section>

        {prev != null && (
          <p className="mt-6 font-sans text-meta text-muted-foreground">
            <Link href={stepHref(prev)} className="hover:text-foreground">
              ← Previous: {steps[prev].title}
            </Link>
          </p>
        )}
      </article>

      {/* Laptop: the step's concepts beside the text, so the width works for you (v0.31.5). */}
      <aside className="sticky top-[calc(var(--fleet-header-h)+3.5rem)] hidden max-h-[calc(100vh_-_var(--fleet-header-h)_-_5rem)] flex-col gap-3 overflow-y-auto pt-10 font-sans lg:flex">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          In this step · {concepts.length} concepts
        </p>
        <p className="text-meta text-muted-foreground">Tap an underlined term in the text, or a concept here.</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {concepts.map((c) => {
            const open = picked === c.name
            return (
              <li key={c.conceptKey ?? c.name} id={`concept-${c.name}`}>
                <button
                  type="button"
                  onClick={() => setPicked(open ? null : c.name)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    open ? "bg-card ring-1 ring-border" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("font-medium", open ? "text-foreground" : "text-foreground/85")}>{c.name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">{c.kind}</span>
                  </span>
                  {open && <span className="mt-1.5 block leading-relaxed text-foreground/90">{c.signal}</span>}
                </button>
              </li>
            )
          })}
        </ul>
        {concepts.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setCheck("open")
              requestAnimationFrame(() => document.getElementById("check")?.scrollIntoView({ block: "start" }))
            }}
            className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-muted-foreground/50"
          >
            Check understanding
          </button>
        )}
      </aside>
      </div>
    </div>
  )
}
