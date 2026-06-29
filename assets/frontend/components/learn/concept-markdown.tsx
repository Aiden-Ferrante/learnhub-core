"use client"

import "katex/dist/katex.min.css"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { cn } from "@/lib/utils"

// Malformed `$…$` from older conversions degrades to plain text in the current color rather
// than a red KaTeX error.
const KATEX = { throwOnError: false, strict: false, errorColor: "currentColor" } as const

/** Inline-friendly markdown + LaTeX for SHORT concept text (signal/source). Unlike
 *  MarkdownReader (full reading-prose width/margins), this inherits the parent's text
 *  color/size and uses tight margins so it sits naturally inside a card or panel. */
export function ConceptMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "concept-md break-words",
        "[&_p]:m-0 [&_p+p]:mt-2 [&_p]:leading-snug",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]",
        "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_strong]:font-semibold [&_em]:italic [&_a]:text-nvidia-green [&_a]:underline",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, KATEX]]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
