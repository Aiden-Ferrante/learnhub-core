"use client"

import "katex/dist/katex.min.css"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/lib/utils"
import type { ReadingTheme } from "@/hooks/use-reading-theme"
import type { Measure, ProseSize } from "@/hooks/use-reading-prefs"

type MarkdownReaderProps = {
  content: string
  className?: string
  /** Reading surface theme. "dark" = app-native prose; "paper" = warm cream + serif. */
  theme?: ReadingTheme
  /** Text size (Tailwind prose scale) and line width — driven by the reading controls. */
  proseSize?: ProseSize
  measure?: Measure
}

const SIZE_CLASS: Record<ProseSize, string> = {
  sm: "prose-sm",
  base: "prose-base",
  lg: "prose-lg",
  xl: "prose-xl",
}
const MEASURE_CLASS: Record<Measure, string> = {
  narrow: "max-w-[60ch]",
  normal: "max-w-[75ch]",
  wide: "max-w-[90ch]",
}

// Malformed `$…$` (stray from older conversions) degrades to plain text in the body
// color instead of a red KaTeX error.
const KATEX_OPTIONS = { throwOnError: false, strict: false, errorColor: "currentColor" } as const

// Bare fences (no language tag) are common in PDF exports — let hljs auto-detect.
const HIGHLIGHT_OPTIONS = { detect: true } as const

/** Renders textbook markdown (GFM + LaTeX math + highlighted code) with calm,
 *  prose-tuned styling. Math is normalized upstream by app/math_markdown.py. */
export function MarkdownReader({
  content,
  className,
  theme = "dark",
  proseSize = "sm",
  measure = "normal",
}: MarkdownReaderProps) {
  const paper = theme === "paper"
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
              "prose-a:text-nvidia-green prose-a:no-underline hover:prose-a:underline",
              "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
              "prose-pre:border prose-pre:bg-muted/40 prose-pre:text-foreground/90 prose-pre:leading-relaxed",
              "prose-blockquote:border-l-nvidia-green/40 prose-blockquote:text-muted-foreground",
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
