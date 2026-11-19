"use client"

/** A section's digest for the chapter hub and path (v0.31.5): its key concepts and an
 *  "In brief" line — never its reading. The human, 2026-11-19: "have the concepts in the
 *  chapter hub be with the sections. The sections shouldn't open up to any readings only key
 *  concepts and summaries perhaps. The reading should only be in the reading portion."
 *
 *  No section summaries are stored (the briefing job has not run on these courses), so
 *  "In brief" is the section's own opening paragraph from the book, quoted, not generated.
 *  One chapter-scope read gives every section's text and concepts. */

import { useMemo, useState } from "react"
import { fetchGuidedReading } from "@/gateways/api/chapter"
import type { ConceptLesson } from "@/gateways/api/concepts"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { qk, useApi } from "@/kit/data"
import { cn } from "@/kit/lib/utils"

function contains(node: LearnTreeNode, key: string): boolean {
  return node.sectionKey === key || node.children.some((c) => contains(c, key))
}

/** "## 2.1 Title", or "## SECTION 1.1 - Title" (PE1's style). */
const headingRe = (num: string) =>
  new RegExp(`^#{1,6}\\s+(?:(?:section|chapter|module|unit)\\s+)?${num.replace(/\./g, "\\.")}(\\s|$)`, "i")

const numberOf = (key: string) => key.replace(/^toc:/, "").replace(/~\d+$/, "")

/** The first real paragraph after the section's own heading: prose, not a heading,
 *  provenance line, quote, list, table or figure. Markdown emphasis and source tags dropped. */
function openingParagraph(markdown: string, sectionKey: string): string | null {
  const num = numberOf(sectionKey)
  if (!/^\d+(\.\d+)*$/.test(num)) return null
  const lines = markdown.split("\n")
  const at = lines.findIndex((l) => headingRe(num).test(l))
  if (at < 0) return null
  for (const raw of lines.slice(at + 1)) {
    const l = raw.trim()
    if (!l || /^(#|\*Topics List|>|\||-|\*\s|\d+\.\s|!\[|\$\$|```)/.test(l)) continue
    const text = l
      .replace(/\[(?:pp?\.|v\d{2}\.|beyond)[^\]]*\]/g, "")
      .replace(/\*\*|__|\*/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (text.length < 60) continue
    return text.length > 320 ? `${text.slice(0, 317).replace(/\s+\S*$/, "")}…` : text
  }
  return null
}

/** Words in the section's own text: from its heading to the next top-level section's heading. */
function sectionWords(markdown: string, sectionKey: string, nextKey: string | undefined): number {
  const lines = markdown.split("\n")
  const at = (key: string | undefined) => {
    if (!key) return -1
    const num = numberOf(key)
    if (!/^\d+(\.\d+)*$/.test(num)) return -1
    return lines.findIndex((l) => headingRe(num).test(l))
  }
  const start = at(sectionKey)
  if (start < 0) return 0
  const end = at(nextKey)
  return lines
    .slice(start + 1, end > start ? end : undefined)
    .join(" ")
    .replace(/\[(?:pp?\.|v\d{2}\.|beyond)[^\]]*\]/g, "")
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length
}

/** Reading minutes at ~230 words a minute, never under 1. */
export const minutesOf = (words: number) => Math.max(1, Math.round(words / 230))

export type SectionDigestData = { concepts: ConceptLesson[]; brief: string | null; words: number }

/** Every top-level section's concepts and opening paragraph, from one chapter read. */
export function useChapterDigest(docId: string | undefined, chapter: LearnTreeNode | undefined) {
  const key = chapter?.sectionKey ?? ""
  const q = useApi(qk.guidedReading(docId ?? "", key), (signal) => fetchGuidedReading(docId ?? "", key, signal), {
    enabled: Boolean(docId && key),
  })
  return useMemo(() => {
    const out = new Map<string, SectionDigestData>()
    const sections = (chapter?.children ?? []).filter((s) => s.sectionKey)
    const md = q.data?.markdown ?? ""
    sections.forEach((s, i) =>
      out.set(s.sectionKey!, {
        concepts: [],
        brief: openingParagraph(md, s.sectionKey!),
        words: sectionWords(md, s.sectionKey!, sections[i + 1]?.sectionKey ?? undefined),
      }),
    )
    for (const c of q.data?.concepts ?? []) {
      const s = sections.find((x) => c.sectionKey && contains(x, c.sectionKey))
      if (s) out.get(s.sectionKey!)!.concepts.push(c)
    }
    return { bySection: out, loading: q.status === "loading" }
  }, [q.data, q.status, chapter])
}

export function SectionDigest({ digest, loading }: { digest: SectionDigestData | undefined; loading?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  if (loading && !digest?.concepts.length) return <p className="text-meta text-muted-foreground">Loading…</p>
  if (!digest) return null
  return (
    <div className="flex flex-col gap-4">
      {digest.brief && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">In brief · from the text</p>
          <p className="font-serif text-[15px] leading-relaxed text-foreground/90">{digest.brief}</p>
        </div>
      )}
      {digest.concepts.length > 0 ? (
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
            Key concepts · {digest.concepts.length}
          </p>
          <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
            {digest.concepts.map((c, i) => {
              const id = c.conceptKey ?? `${c.name}-${i}`
              const isOpen = open === id
              return (
                <li key={id} className={cn(isOpen && "sm:col-span-2")}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : id)}
                    aria-expanded={isOpen}
                    className={cn(
                      "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      isOpen ? "bg-background ring-1 ring-border" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">{c.kind}</span>
                    </span>
                    {isOpen && <span className="mt-1.5 block leading-relaxed text-foreground/90">{c.signal}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        !digest.brief && <p className="text-meta text-muted-foreground">No concepts in this section.</p>
      )}
    </div>
  )
}
