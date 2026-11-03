"use client"

import React, { useMemo, useRef } from "react"
import type { GuidedReadingResponse } from "@/gateways/api/chapter"
import type { OutlineEntry } from "@/gateways/api/outline"
import type { ConceptMastery } from "@/gateways/api/progress"
import { MarkdownReader } from "@/surfaces/reading/markdown-reader"
import type { ReadingTheme } from "@/surfaces/reading/use-reading-theme"
import type { ReadingPrefs } from "@/surfaces/reading/use-reading-prefs"
import { cn } from "@/kit/lib/utils"
import { annotateNode, buildConceptRegex, masteryTint, masteryWash } from "./concept-annotations"
import { relevelHeadings } from "./lib"

/** The chapter's prose as one memoized element: headings re-levelled from the outline,
 *  concept mentions annotated (mastery tint + optional wash). Memoized so popover,
 *  selection and drawer state changes never re-parse a whole chapter of markdown. */
export function useAnnotatedReader({
  data,
  outline,
  chapterKey,
  theme,
  prefs,
  masteryByKey,
  highlightConcepts,
}: {
  data: GuidedReadingResponse | undefined
  outline: OutlineEntry[]
  chapterKey: string | null
  theme: ReadingTheme
  prefs: ReadingPrefs
  masteryByKey: Record<string, ConceptMastery>
  highlightConcepts: boolean
}) {
  const concepts = useMemo(() => data?.concepts ?? [], [data])
  const conceptsRef = useRef(concepts)
  conceptsRef.current = concepts

  const indexByName = useMemo(() => {
    const m = new Map<string, number>()
    concepts.forEach((c, i) => {
      const k = c.name.trim().toLowerCase()
      if (!m.has(k)) m.set(k, i)
    })
    return m
  }, [concepts])

  // Flat `##` walls → real hierarchy, from the outline's nesting.
  const displayMarkdown = useMemo(
    () => (data?.markdown ? relevelHeadings(data.markdown, outline, chapterKey) : ""),
    [data?.markdown, outline, chapterKey],
  )

  const reader = useMemo(() => {
    if (!displayMarkdown) return null
    const regex = buildConceptRegex(concepts)
    const classFor = (idx: number) => {
      const c = concepts[idx]
      const m = c?.conceptKey ? masteryByKey[c.conceptKey] : undefined
      return cn(masteryTint(m), highlightConcepts && masteryWash(m))
    }
    const annotate = (children: React.ReactNode) =>
      regex ? annotateNode(children, regex, indexByName, new Set<string>(), classFor) : children
    return (
      <MarkdownReader
        content={displayMarkdown}
        theme={theme}
        proseSize={prefs.size}
        measure={prefs.measure}
        // content-visibility keeps 50–90K-char chapters snappy: below-fold blocks skip
        // layout/paint until scrolled near.
        className="[&>*]:[content-visibility:auto] [&>*]:[contain-intrinsic-size:auto_150px]"
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
  }, [displayMarkdown, concepts, indexByName, theme, prefs.size, prefs.measure, masteryByKey, highlightConcepts])

  return { concepts, conceptsRef, indexByName, displayMarkdown, reader }
}
