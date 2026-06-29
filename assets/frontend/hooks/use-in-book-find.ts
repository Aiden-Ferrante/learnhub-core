"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// In-reader text find over a scroll container. Uses the CSS Custom Highlight API
// (Chromium/modern) to paint matches without mutating the DOM; degrades to plain
// scroll-to-match where unsupported. Esc / Ctrl+F are handled here.

const HL = "book-find"
const HL_ACTIVE = "book-find-active"
// Upper bound on highlighted matches — keeps ranging/painting fast and bounded.
const MAX_MATCHES = 2000

type FindState = {
  open: boolean
  query: string
  count: number
  active: number // 0-based; -1 when no matches
}

const CLOSED: FindState = { open: false, query: "", count: 0, active: -1 }

export function useInBookFind(containerRef: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState<FindState>(CLOSED)
  const rangesRef = useRef<Range[]>([])
  const openRef = useRef(false)
  openRef.current = state.open

  const supported =
    typeof window !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS

  const clearHighlights = useCallback(() => {
    if (supported) {
      const reg = (CSS as unknown as { highlights: Map<string, unknown> }).highlights
      reg.delete(HL)
      reg.delete(HL_ACTIVE)
    }
    rangesRef.current = []
  }, [supported])

  const paint = useCallback(
    (ranges: Range[], active: number) => {
      if (!supported) return
      // NB: build the Highlight via .add() — spreading a large Range[] into the
      // constructor (`new Highlight(...ranges)`) overflows the call stack on big
      // match sets (Firefox: "InternalError: too much recursion").
      const HighlightCtor = (
        window as unknown as { Highlight: new () => { add: (r: Range) => void } }
      ).Highlight
      const reg = (CSS as unknown as { highlights: Map<string, unknown> }).highlights
      const rest = new HighlightCtor()
      ranges.forEach((r, i) => {
        if (i !== active) rest.add(r)
      })
      reg.set(HL, rest as unknown)
      if (active >= 0 && ranges[active]) {
        const act = new HighlightCtor()
        act.add(ranges[active])
        reg.set(HL_ACTIVE, act as unknown)
      } else {
        reg.delete(HL_ACTIVE)
      }
    },
    [supported],
  )

  const scrollToActive = useCallback((ranges: Range[], active: number) => {
    const r = ranges[active]
    if (!r) return
    const el = r.startContainer.parentElement
    el?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [])

  const search = useCallback(
    (query: string) => {
      const container = containerRef.current
      // Require 2+ chars: a single common letter yields tens of thousands of
      // matches (slow to range, pointless to read). Clears highlights meanwhile.
      if (!container || query.trim().length < 2) {
        clearHighlights()
        setState((s) => ({ ...s, query, count: 0, active: -1 }))
        return
      }
      const q = query.toLowerCase()
      const ranges: Range[] = []
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      let node: Node | null
      outer: while ((node = walker.nextNode())) {
        const lower = (node.nodeValue || "").toLowerCase()
        let from = 0
        let idx = lower.indexOf(q, from)
        while (idx !== -1) {
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + q.length)
          ranges.push(range)
          if (ranges.length >= MAX_MATCHES) break outer
          from = idx + q.length
          idx = lower.indexOf(q, from)
        }
      }
      rangesRef.current = ranges
      const active = ranges.length > 0 ? 0 : -1
      paint(ranges, active)
      if (active >= 0) scrollToActive(ranges, active)
      setState((s) => ({ ...s, query, count: ranges.length, active }))
    },
    [containerRef, clearHighlights, paint, scrollToActive],
  )

  const step = useCallback(
    (dir: 1 | -1) => {
      const ranges = rangesRef.current
      if (ranges.length === 0) return
      setState((s) => {
        const active = (s.active + dir + ranges.length) % ranges.length
        paint(ranges, active)
        scrollToActive(ranges, active)
        return { ...s, active }
      })
    },
    [paint, scrollToActive],
  )

  const openFind = useCallback(() => setState((s) => ({ ...s, open: true })), [])

  const close = useCallback(() => {
    clearHighlights()
    setState(CLOSED)
  }, [clearHighlights])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        if (!containerRef.current) return
        e.preventDefault()
        setState((s) => ({ ...s, open: true }))
      } else if (e.key === "Escape" && openRef.current) {
        clearHighlights()
        setState(CLOSED)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [containerRef, clearHighlights])

  // Clear painted ranges if the component unmounts.
  useEffect(() => clearHighlights, [clearHighlights])

  return {
    open: state.open,
    query: state.query,
    count: state.count,
    active: state.active,
    supported,
    search,
    next: () => step(1),
    prev: () => step(-1),
    openFind,
    close,
  }
}
