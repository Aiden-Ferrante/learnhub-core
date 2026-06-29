"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// User highlights / notes over the reader. Persisted in localStorage by docId, re-anchored on
// load by finding the saved text (first occurrence) and painted via the CSS Custom Highlight API
// (React-safe). Click a highlight to see/remove its note — handled by caret hit-testing.

const HL = "user-highlight"
const keyFor = (docId?: string) => `txt2k:annot:${docId || "latest"}`

export type Annotation = { id: string; scope: string; text: string; note?: string; ts: number }
export type SelToolbar = { x: number; y: number; text: string } | null
export type ActiveNote = { ann: Annotation; x: number; y: number } | null

function loadAll(docId?: string): Annotation[] {
  try {
    const raw = localStorage.getItem(keyFor(docId))
    return raw ? (JSON.parse(raw) as Annotation[]) : []
  } catch {
    return []
  }
}
function persist(docId: string | undefined, list: Annotation[]) {
  try {
    localStorage.setItem(keyFor(docId), JSON.stringify(list))
  } catch {
    // storage may be unavailable
  }
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

export function useTextAnnotations(
  containerRef: React.RefObject<HTMLElement | null>,
  docId: string | undefined,
  scope: string | null,
) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [toolbar, setToolbar] = useState<SelToolbar>(null)
  const [activeNote, setActiveNote] = useState<ActiveNote>(null)
  const itemsRef = useRef<{ ann: Annotation; range: Range }[]>([])
  const supported =
    typeof window !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS

  useEffect(() => {
    setAnnotations(loadAll(docId))
  }, [docId])

  const scoped = annotations.filter((a) => a.scope === scope)

  const add = useCallback(
    (text: string, note?: string) => {
      if (!scope) return
      setAnnotations((cur) => {
        const next = [
          ...cur,
          { id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`, scope, text, note, ts: Date.now() },
        ]
        persist(docId, next)
        return next
      })
      setToolbar(null)
      window.getSelection()?.removeAllRanges()
    },
    [docId, scope],
  )

  const remove = useCallback(
    (id: string) => {
      setAnnotations((cur) => {
        const next = cur.filter((a) => a.id !== id)
        persist(docId, next)
        return next
      })
      setActiveNote(null)
    },
    [docId],
  )

  // Selection → floating toolbar (require a non-trivial selection inside the reader).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        setToolbar(null)
        return
      }
      const text = sel.toString().trim()
      if (text.length < 6 || !container.contains(sel.anchorNode)) {
        setToolbar(null)
        return
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setToolbar({ x: rect.left + rect.width / 2, y: rect.top, text })
    }
    document.addEventListener("mouseup", onUp)
    return () => document.removeEventListener("mouseup", onUp)
  }, [containerRef])

  // Re-anchor + paint saved annotations for this section.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !supported) return
    const id = requestAnimationFrame(() => {
      const items: { ann: Annotation; range: Range }[] = []
      const reg = (CSS as unknown as { highlights: Map<string, unknown> }).highlights
      for (const ann of scoped) {
        const needle = ann.text.toLowerCase().slice(0, 200)
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
        let node: Node | null
        while ((node = walker.nextNode())) {
          const idx = (node.nodeValue || "").toLowerCase().indexOf(needle)
          if (idx === -1) continue
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, Math.min((node.nodeValue || "").length, idx + needle.length))
          items.push({ ann, range })
          break
        }
      }
      itemsRef.current = items
      if (items.length === 0) {
        reg.delete(HL)
        return
      }
      const Ctor = (window as unknown as { Highlight: new () => { add: (r: Range) => void } })
        .Highlight
      const hl = new Ctor()
      items.forEach((it) => hl.add(it.range))
      reg.set(HL, hl as unknown)
    })
    return () => {
      cancelAnimationFrame(id)
      if (supported) (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(HL)
    }
  }, [containerRef, supported, scoped])

  // Click a saved highlight → open its note/remove popover.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !supported) return
    const onClick = (e: MouseEvent) => {
      const c = caretNode(e.clientX, e.clientY)
      if (!c) return
      const hit = itemsRef.current.find(
        (it) =>
          it.range.startContainer === c.node &&
          c.offset >= it.range.startOffset &&
          c.offset <= it.range.endOffset,
      )
      if (hit) {
        e.preventDefault()
        setActiveNote({ ann: hit.ann, x: e.clientX, y: e.clientY })
      }
    }
    container.addEventListener("click", onClick)
    return () => container.removeEventListener("click", onClick)
  }, [containerRef, supported])

  return { toolbar, setToolbar, activeNote, setActiveNote, add, remove, count: scoped.length }
}
