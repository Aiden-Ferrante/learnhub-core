"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ConceptLesson } from "@/lib/learn-service"

// Paints each concept's verbatim `source` sentence inside the reader using the CSS Custom
// Highlight API (no DOM mutation, so it's safe alongside react-markdown), then makes those
// highlights interactive via caret hit-testing on pointer events — click to study a concept,
// hover for its name. Degrades to nothing where the Highlight API is unavailable.

const HL = "concept-source"
const HL_TERM = "concept-term"

type HitItem = { key: string; name: string; kind: string; signal: string; range: Range }
export type ConceptHover = {
  key: string
  name: string
  kind: string
  signal: string
  x: number
  y: number
}

function caretNode(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as unknown as {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  return null
}

export function useConceptHighlights(
  containerRef: React.RefObject<HTMLElement | null>,
  concepts: ConceptLesson[],
  onConceptClick: (key: string) => void,
) {
  const itemsRef = useRef<HitItem[]>([])
  const [hover, setHover] = useState<ConceptHover | null>(null)
  const [count, setCount] = useState(0)
  const supported =
    typeof window !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS

  const hitAt = useCallback((x: number, y: number): HitItem | null => {
    const c = caretNode(x, y)
    if (!c) return null
    for (const it of itemsRef.current) {
      if (
        it.range.startContainer === c.node &&
        c.offset >= it.range.startOffset &&
        c.offset <= it.range.endOffset
      ) {
        return it
      }
    }
    return null
  }, [])

  // Build + paint highlights whenever the content or concept set changes.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !supported) return

    const id = requestAnimationFrame(() => {
      const usable = concepts.filter((c) => c.conceptKey && c.name)
      // Source-sentence targets (one highlight per concept) + glossary term targets (every
      // occurrence of a distinctive concept name → hover shows its definition).
      const sourceTargets = usable
        .filter((c) => c.source && c.source.trim().length > 12)
        .map((c) => ({ c, needle: (c.source as string).toLowerCase().slice(0, 160) }))
      const termTargets = usable
        .filter((c) => c.name.trim().length >= 6)
        .map((c) => ({ c, needle: c.name.toLowerCase().trim() }))

      const sourceItems: HitItem[] = []
      const termItems: HitItem[] = []
      const claimedSource = new Set<string>()
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const raw = node.nodeValue || ""
        if (raw.length < 6) continue
        const lower = raw.toLowerCase()
        for (const t of sourceTargets) {
          const k = t.c.conceptKey as string
          if (claimedSource.has(k)) continue
          const idx = lower.indexOf(t.needle)
          if (idx === -1) continue
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, Math.min(raw.length, idx + t.needle.length))
          sourceItems.push({ key: k, name: t.c.name, kind: t.c.kind, signal: t.c.signal, range })
          claimedSource.add(k)
        }
        for (const t of termTargets) {
          let from = lower.indexOf(t.needle)
          while (from !== -1) {
            const range = document.createRange()
            range.setStart(node, from)
            range.setEnd(node, from + t.needle.length)
            termItems.push({
              key: t.c.conceptKey as string,
              name: t.c.name,
              kind: t.c.kind,
              signal: t.c.signal,
              range,
            })
            from = lower.indexOf(t.needle, from + t.needle.length)
          }
        }
      }
      // Source sentences take precedence in hit-testing (listed first).
      itemsRef.current = [...sourceItems, ...termItems]
      setCount(sourceItems.length)
      const reg = (CSS as unknown as { highlights: Map<string, unknown> }).highlights
      const Ctor = (window as unknown as { Highlight: new () => { add: (r: Range) => void } })
        .Highlight
      const paint = (name: string, items: HitItem[]) => {
        if (items.length === 0) {
          reg.delete(name)
          return
        }
        const hl = new Ctor()
        items.forEach((it) => hl.add(it.range))
        reg.set(name, hl as unknown)
      }
      paint(HL, sourceItems)
      paint(HL_TERM, termItems)
    })

    return () => {
      cancelAnimationFrame(id)
      if (supported) {
        const reg = (CSS as unknown as { highlights: Map<string, unknown> }).highlights
        reg.delete(HL)
        reg.delete(HL_TERM)
      }
    }
  }, [containerRef, concepts, supported])

  // Pointer interactions: click to study, hover for the concept name + a pointer cursor.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !supported) return

    const onClick = (e: MouseEvent) => {
      const hit = hitAt(e.clientX, e.clientY)
      if (hit) {
        e.preventDefault()
        onConceptClick(hit.key)
      }
    }
    let raf = 0
    const onMove = (e: MouseEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const hit = hitAt(e.clientX, e.clientY)
        container.style.cursor = hit ? "pointer" : ""
        setHover(
          hit
            ? { key: hit.key, name: hit.name, kind: hit.kind, signal: hit.signal, x: e.clientX, y: e.clientY }
            : null,
        )
      })
    }
    const onLeave = () => {
      container.style.cursor = ""
      setHover(null)
    }
    container.addEventListener("click", onClick)
    container.addEventListener("mousemove", onMove)
    container.addEventListener("mouseleave", onLeave)
    return () => {
      container.removeEventListener("click", onClick)
      container.removeEventListener("mousemove", onMove)
      container.removeEventListener("mouseleave", onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [containerRef, supported, hitAt, onConceptClick])

  return { hover, count, supported }
}
