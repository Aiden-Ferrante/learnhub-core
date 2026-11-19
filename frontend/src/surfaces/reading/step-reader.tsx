"use client"

/** TRIAL (v0.31.5): read a chapter one step at a time, from the chapter path.
 *
 *  Human decisions 2026-11-19: laptop first; "Check understanding" closes each step and is
 *  optional, with Skip. Then, on A Philosophy of Software Design: bigger text, no concepts
 *  panel ("I want to just read the material and have it be broken down").
 *
 *  A step is cut into short parts (~250 words, at headings or paragraph ends) shown one at a
 *  time with Continue. The book's text is unchanged: same words, same order, only paced.
 *  Content is the section scope of the existing guided-reading API. */

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Components } from "react-markdown"
import { fetchGuidedReading } from "@/gateways/api/chapter"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { qk, useApi } from "@/kit/data"
import { useReadSteps } from "@/kit/lib/read-steps"
import { cn } from "@/kit/lib/utils"
import { MarkdownReader } from "@/surfaces/reading/markdown-reader"
import { ReviewPanel } from "@/surfaces/studying"

const SIZES = [
  { label: "A", className: "text-[20px]" },
  { label: "A+", className: "text-[22px]" },
] as const
const SIZE_KEY = "lh-step-reader-size"
const SOURCE_TAG = /\[((?:pp?\.|v\d{2}\.|beyond)[^\]]*)\]/g
const PART_WORDS = 250
const WPM = 230

export type Step = { node: LearnTreeNode; title: string }

/** Drop the section's own heading (the page names the step), quiet the provenance lines
 *  ("*Topics List … · [pp.11–92 · v06.03]*") and turn inline source tags into marker links. */
function prepare(markdown: string): string {
  const lines = markdown.split("\n")
  if (/^#{1,3}\s/.test(lines[0] ?? "")) lines.shift()
  return lines
    .map((l) => (/^\*Topics List\b.*\*$/.test(l.trim()) ? `> ${l.trim().replace(/^\*|\*$/g, "")}` : l))
    .join("\n")
    .replace(SOURCE_TAG, (_m, tag: string) => `[${tag}](#src)`)
}

const wordsIn = (t: string) =>
  t.replace(/\[[^\]]*\]\(#src\)/g, "").split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length

/** Markdown blocks: blank-line separated, but a fenced code or $$ math block stays whole. */
function blocksOf(md: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let fence: string | null = null
  for (const line of md.split("\n")) {
    const t = line.trim()
    if (fence) {
      cur.push(line)
      if (t.startsWith(fence)) fence = null
      continue
    }
    if (/^(```|~~~)/.test(t)) fence = t.slice(0, 3)
    else if (t === "$$" || (t.startsWith("$$") && !t.slice(2).includes("$$"))) fence = "$$"
    if (!t && !fence) {
      if (cur.length) out.push(cur.join("\n"))
      cur = []
    } else cur.push(line)
  }
  if (cur.length) out.push(cur.join("\n"))
  return out
}

/** Cut a step into parts of about PART_WORDS: at a heading, or at the end of a paragraph once
 *  the part is long enough. Never after a line ending in ":" (it introduces what follows),
 *  never before a list item, quote or table that continues the block before it. A short
 *  tail joins the part before it. */
function partsOf(md: string): string[] {
  const parts: string[][] = []
  let cur: string[] = []
  let words = 0
  for (const b of blocksOf(md)) {
    const t = b.trim()
    const heading = /^#{1,6}\s/.test(t)
    const continues = /^([-*+]\s|\d+[.)]\s|>|\||\$\$|!\[)/.test(t) || /:\s*$/.test(cur[cur.length - 1]?.trim() ?? "")
    if (cur.length && ((heading && words >= 80) || (!heading && !continues && words >= PART_WORDS))) {
      parts.push(cur)
      cur = []
      words = 0
    }
    cur.push(b)
    if (!heading) words += wordsIn(b)
  }
  if (cur.length) {
    if (parts.length && words < 80) parts[parts.length - 1].push(...cur)
    else parts.push(cur)
  }
  return parts.map((p) => p.join("\n\n"))
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

const components: Components = {
  a: ({ href, children }) =>
    href === "#src" ? (
      <sup className="mx-0.5 align-super font-sans text-[10px] text-muted-foreground/60 no-underline">{children}</sup>
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
}

const PROSE = cn(
  "max-w-none font-serif leading-[1.8]",
  "prose-p:text-foreground prose-li:text-foreground prose-p:my-[1.1em]",
  "prose-headings:font-serif prose-h2:mt-10 prose-h2:text-[1.3em] prose-h3:mt-10 prose-h3:text-[1.2em] prose-h4:text-[1.05em]",
  // Long display equations scroll inside their own box, never the page.
  "[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1",
  "[&_.katex]:inline-block [&_.katex]:max-w-full [&_.katex]:overflow-x-auto [&_.katex]:overflow-y-hidden [&_.katex]:align-middle",
)

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
  const conceptCount = q.data?.concepts?.length ?? 0
  const { markRead } = useReadSteps(docId)
  const [size, setSize] = useState(0)
  const [check, setCheck] = useState<"offer" | "open" | "skipped">("offer")
  const [shown, setShown] = useState(1)
  const partRefs = useRef<(HTMLDivElement | null)[]>([])

  const parts = useMemo(() => partsOf(prepare(q.data?.markdown ?? "")), [q.data])
  const partWords = useMemo(() => parts.map(wordsIn), [parts])
  const allShown = shown >= parts.length
  const minutesLeft = Math.max(1, Math.round(partWords.slice(shown - 1).reduce((a, b) => a + b, 0) / WPM))
  const totalMinutes = Math.max(1, Math.round(partWords.reduce((a, b) => a + b, 0) / WPM))

  useEffect(() => {
    const v = Number(localStorage.getItem(SIZE_KEY) ?? 0)
    setSize(v === 1 ? 1 : 0)
  }, [])
  useEffect(() => {
    onOpen(key)
    // "Check understanding" on the path links here with #check: the whole step, check open.
    if (window.location.hash === "#check") {
      setShown(Number.MAX_SAFE_INTEGER)
      setCheck("open")
      requestAnimationFrame(() => document.getElementById("check")?.scrollIntoView({ block: "start" }))
    } else {
      setShown(1)
      setCheck("offer")
      window.scrollTo({ top: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per step
  }, [key])
  useEffect(() => {
    if (q.data && allShown) markRead(key)
  }, [q.data, allShown, key, markRead])

  const more = () => {
    const i = shown
    setShown(i + 1)
    requestAnimationFrame(() => partRefs.current[i]?.scrollIntoView({ block: "start", behavior: "smooth" }))
  }

  const next = index + 1 < steps.length ? index + 1 : null
  const prev = index > 0 ? index - 1 : null
  const offerCheck = check === "offer" && conceptCount > 0

  return (
    <div className="pb-24">
      <div className="sticky top-[var(--fleet-header-h)] z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[56rem] items-center gap-4 px-4 py-2.5 text-meta">
          <Link href={pathHref} className="shrink-0 text-muted-foreground hover:text-foreground">
            ← {chapterNumber ? `Chapter ${chapterNumber}` : chapterTitle}
          </Link>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Step {index + 1} of {steps.length}
            {parts.length > 1 && ` · part ${Math.min(shown, parts.length)} of ${parts.length}`}
            {parts.length > 0 && !allShown && ` · ${minutesLeft} min left`}
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

      <article className={cn("mx-auto max-w-[calc(30em+2rem)] px-4 pt-12", SIZES[size].className)}>
        <p className="mb-3 font-sans text-xs uppercase tracking-widest text-muted-foreground">
          {chapterNumber ? `Chapter ${chapterNumber} · ` : ""}Step {index + 1}
          {parts.length > 0 && ` · ${totalMinutes} min read`}
        </p>
        <h1 className="m-0 mb-10 font-serif text-[1.9em] font-semibold leading-tight">{step.title}</h1>

        {q.status === "loading" && !q.data ? (
          <p className="text-muted-foreground">Loading this step…</p>
        ) : q.error && !q.data ? (
          <p className="text-ink-warn">Couldn&apos;t load this step. {String(q.error.message ?? "")}</p>
        ) : (
          parts.slice(0, shown).map((part, i) => (
            <div
              key={i}
              ref={(el) => {
                partRefs.current[i] = el
              }}
              className={cn("scroll-mt-28", i > 0 && "mt-10 border-t border-border/50 pt-8")}
            >
              <MarkdownReader content={part} measure="narrow" proseSize="lg" components={components} className={cn(PROSE, "text-[1em]")} />
            </div>
          ))
        )}

        {q.data && !allShown && (
          <div className="mt-10 flex items-center gap-4 font-sans">
            <button
              type="button"
              onClick={more}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Continue ↓
            </button>
            <span className="text-meta tabular-nums text-muted-foreground">
              Part {shown + 1} of {parts.length} · {Math.max(1, Math.round(partWords[shown] / WPM))} min
            </span>
            <button
              type="button"
              onClick={() => setShown(parts.length)}
              className="ml-auto text-meta text-muted-foreground hover:text-foreground"
            >
              Show the rest
            </button>
          </div>
        )}

        {q.data && allShown && (
          <section id="check" className="mt-16 scroll-mt-24 rounded-2xl border border-border bg-card p-6 font-sans text-base">
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
                  {offerCheck ? `Check your understanding · ${conceptCount} concepts` : "Step read"}
                </h2>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {offerCheck && (
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
                        offerCheck ? "border border-border text-muted-foreground hover:text-foreground" : "bg-primary text-primary-foreground",
                      )}
                    >
                      {offerCheck ? "Skip · next step →" : `Next: ${steps[next].title} →`}
                    </Link>
                  ) : (
                    <Link
                      href={pathHref}
                      className={cn(
                        "rounded-lg px-4 py-2.5 text-sm font-semibold",
                        offerCheck ? "border border-border" : "bg-primary text-primary-foreground",
                      )}
                    >
                      {offerCheck ? "Skip · back to the chapter" : "Back to the chapter exam"}
                    </Link>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {prev != null && (
          <p className="mt-6 font-sans text-meta text-muted-foreground">
            <Link href={stepHref(prev)} className="hover:text-foreground">
              ← Previous: {steps[prev].title}
            </Link>
          </p>
        )}
      </article>
    </div>
  )
}
