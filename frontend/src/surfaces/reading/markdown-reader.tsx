"use client"

import "katex/dist/katex.min.css"
import { useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/kit/lib/utils"
import type { ReadingTheme } from "@/surfaces/reading/use-reading-theme"
import type { Measure, ProseSize } from "@/surfaces/reading/use-reading-prefs"

type MarkdownReaderProps = {
  content: string
  className?: string
  /** Reading surface theme. "dark" = app-native prose; "paper" = warm cream + serif. */
  theme?: ReadingTheme
  /** Text size (Tailwind prose scale) and line width — driven by the reading controls. */
  proseSize?: ProseSize
  measure?: Measure
  /** Extra react-markdown component overrides (e.g. inline concept annotation). */
  components?: Components
}

const SIZE_CLASS: Record<ProseSize, string> = {
  sm: "prose-sm",
  base: "prose-base",
  lg: "prose-lg",
  xl: "prose-xl",
}
const MEASURE_CLASS: Record<Measure, string> = {
  narrow: "max-w-[70ch]",
  normal: "max-w-[85ch]",
  wide: "max-w-[100ch]",
}

// Malformed `$…$` (stray from older conversions) degrades to plain text in the body
// color instead of a red KaTeX error.
const KATEX_OPTIONS = { throwOnError: false, strict: false, errorColor: "currentColor" } as const

// Bare fences (no language tag) are common in PDF exports — let hljs auto-detect.
const HIGHLIGHT_OPTIONS = { detect: true } as const

/** PDF-extraction debris that survives conversion: lines that are only a bare `|`
 *  (table remnants that render as orphaned pipes) and a space wedged before
 *  punctuation ("faults , and"). Applied to prose segments only — never inside
 *  fenced code blocks. */
function tidyProse(seg: string): string {
  return seg
    .replace(/^[ \t]*\|[ \t]*$/gm, "")
    .replace(/(\S) +([,.;:!?])(?=\s|$)/gm, "$1$2")
}

function tidyMarkdown(content: string): string {
  return content
    .split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/)
    .map((seg, i) => (i % 2 ? seg : tidyProse(seg)))
    .join("")
}

/** Inline math-aware text for the LLM-generated layer (concept signals, deep
 *  explanations, quiz checks, briefing lines) — models emit TeX for math books
 *  and it must never show raw. Normalizes \\( \\) / \\[ \\] to $-delimiters
 *  (remark-math only parses those), then renders markdown + KaTeX. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const normalized = useMemo(
    () =>
      text
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, x: string) => `$$${x}$$`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, x: string) => `$${x}$`),
    [text],
  )
  return (
    <div className={cn("[&_p]:m-0 [&_p+p]:mt-2", className)}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}>
        {normalized}
      </ReactMarkdown>
    </div>
  )
}

/** Renders textbook markdown (GFM + LaTeX math + highlighted code) with calm,
 *  prose-tuned styling. Math is normalized upstream by app/math_markdown.py. */
export function MarkdownReader({
  content,
  className,
  theme = "dark",
  proseSize = "sm",
  measure = "normal",
  components,
}: MarkdownReaderProps) {
  const paper = theme === "paper"
  const tidied = useMemo(() => tidyMarkdown(content), [content])
  return (
    <div
      className={cn(
        "markdown-reader prose mx-auto",
        SIZE_CLASS[proseSize],
        MEASURE_CLASS[measure],
        paper
          ? cn(
              // Warm paper read: serif body + cream prose vars come from .read-paper-prose.
              "read-paper-prose",
              "prose-headings:font-semibold prose-headings:tracking-tight",
              "prose-a:no-underline hover:prose-a:underline",
              "prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
              "prose-pre:border prose-pre:leading-relaxed prose-img:rounded-lg",
            )
          : cn(
              "prose-invert",
              // Premium-calm tuning: accent only for links, hairline surfaces for code/tables.
              "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground",
              "prose-p:text-foreground/90 prose-li:text-foreground/90 prose-strong:text-foreground",
              "prose-a:text-brand prose-a:no-underline hover:prose-a:underline",
              "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
              "prose-pre:border prose-pre:bg-muted/40 prose-pre:text-foreground/90 prose-pre:leading-relaxed",
              "prose-blockquote:border-l-brand/40 prose-blockquote:text-muted-foreground",
              "prose-hr:border-border prose-img:rounded-lg",
              "prose-th:text-foreground prose-td:border-border prose-th:border-border",
            ),
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS], [rehypeHighlight, HIGHLIGHT_OPTIONS]]}
        components={{
          // Let wide GFM tables scroll horizontally instead of overflowing the pane.
          table: ({ node, ...props }) => (
            <div className="my-4 overflow-x-auto">
              <table {...props} />
            </div>
          ),
          ...components,
        }}
      >
        {tidied}
      </ReactMarkdown>
    </div>
  )
}
