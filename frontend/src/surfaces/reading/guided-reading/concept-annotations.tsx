/** Inline concept annotation — the engine that turns concept-name mentions inside prose into
 *  live spans, tinted by mastery state. Marked first-per-paragraph statelessly here; a
 *  post-render DOM pass in the orchestrator dedupes to first-per-chapter (that pass is an
 *  impure layout effect feeding the outline rail, so it stays in the shell by design). */

import React from "react"
import type { ConceptLesson } from "@/gateways/api/concepts"
import type { ConceptMastery } from "@/gateways/api/progress"
import { cn } from "@/kit/lib/utils"

/** Underline tint = live mastery state: unseen (quiet invite), learning, due again (amber),
 *  mastered (solid). This is where the reader meets the retention loop. */
export function masteryTint(m: ConceptMastery | undefined, threshold: number): string {
  if (!m || !m.attempts) return "border-dotted border-brand/50"
  if (m.mastery >= threshold) return "border-solid border-brand/60"
  if (m.due != null && m.due <= Date.now() / 1000) return "border-dotted border-amber-400/80"
  return "border-dotted border-brand/90"
}

/** Highlighter wash (toggleable in reading settings): brightest on unseen concepts,
 *  amber when due, nearly invisible once mastered — the chapter fades as you learn it. */
export function masteryWash(m: ConceptMastery | undefined, threshold: number): string {
  if (m && m.attempts) {
    if (m.mastery >= threshold) return "rounded-[3px] bg-brand/[0.05]"
    if (m.due != null && m.due <= Date.now() / 1000) return "rounded-[3px] bg-amber-400/10"
  }
  return "rounded-[3px] bg-brand/10"
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function buildConceptRegex(concepts: ConceptLesson[]): RegExp | null {
  const names = Array.from(new Set(concepts.map((c) => c.name.trim()).filter((n) => n.length >= 3)))
  if (names.length === 0) return null
  names.sort((a, b) => b.length - a.length)
  return new RegExp(`\\b(${names.map(escapeRegExp).join("|")})\\b`, "gi")
}

export function annotateNode(
  children: React.ReactNode,
  regex: RegExp,
  indexByName: Map<string, number>,
  seen: Set<string>,
  classForIdx: (idx: number) => string,
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
            className={cn(
              "dc-term cursor-pointer rounded-sm border-b bg-transparent p-0 text-inherit hover:bg-brand/10",
              classForIdx(idx),
            )}
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
      return React.cloneElement(child, undefined, annotateNode(inner, regex, indexByName, seen, classForIdx))
    }
    return child
  })
}
