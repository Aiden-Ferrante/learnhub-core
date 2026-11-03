"use client"

import { useEffect, useMemo, useState, type MutableRefObject, type ReactNode, type RefObject } from "react"
import type { ConceptLesson } from "@/gateways/api/concepts"
import type { ChapterOutlineItem } from "@/gateways/api/outline"
import { layoutNotes, normHeading, numberOutlineItems, type MarginNote } from "./lib"
import type { RailItem } from "./outline-rail"

/** The post-render pass over the committed chapter DOM, in one hook:
 *  1. dedupe concept underlines to the FIRST mention of each concept in the chapter
 *     (per-paragraph marking alone is too noisy);
 *  2. read the rendered headings into the chapter outline (and `headingEls` for the
 *     scroll-spy and rail jumps);
 *  3. on wide screens, place margin notes beside the kept spans, re-measured on scroll
 *     (below-fold content-visibility blocks report ESTIMATED offsets until rendered, so
 *     the throttled re-measure self-corrects; no rAF/IntersectionObserver, which never
 *     fire in hidden tabs);
 *  4. bind the rail to the text: match the canonical (dashboard) outline to the rendered
 *     headings and stamp its numbers onto them, falling back to synthesized numbering only
 *     when the tree has no entry for this chapter, so rail, text and dashboard can't drift. */
export function useChapterDom({
  wrapperRef,
  scrollRef,
  headingEls,
  reader,
  displayMarkdown,
  wide,
  conceptsRef,
  treeOutline,
  chapterKey,
  activeOutline,
  setActiveOutline,
}: {
  wrapperRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  headingEls: MutableRefObject<HTMLElement[]>
  /** The memoized reader element; a new one means a new DOM to walk. */
  reader: ReactNode
  displayMarkdown: string
  wide: boolean
  conceptsRef: MutableRefObject<ConceptLesson[]>
  treeOutline: ChapterOutlineItem[]
  chapterKey: string | null
  activeOutline: number
  setActiveOutline: (i: number) => void
}) {
  const [notes, setNotes] = useState<MarginNote[]>([])
  const [outlineItems, setOutlineItems] = useState<{ text: string; level: number }[]>([])
  // treeOutline item index → rendered-heading index (or -1 when the text has no match).
  const [railTargets, setRailTargets] = useState<number[]>([])

  // Chapter switch: margin notes belong to the chapter that placed them.
  useEffect(() => {
    setNotes([])
  }, [chapterKey])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !displayMarkdown) return
    const seen = new Set<string>()
    const kept: HTMLElement[] = []
    wrapper.querySelectorAll<HTMLElement>(".markdown-reader [data-concept]").forEach((el) => {
      const k = el.dataset.concept!
      if (seen.has(k)) el.replaceWith(document.createTextNode(el.textContent || ""))
      else {
        seen.add(k)
        kept.push(el)
      }
    })

    // Ignore the number spans WE inject into headings, or re-runs would read
    // "1.2 Reliability" as the book's own number and skip renumbering.
    const heads = Array.from(
      wrapper.querySelectorAll<HTMLElement>(".markdown-reader h2, .markdown-reader h3, .markdown-reader h4"),
    )
    headingEls.current = heads
    const ownText = (el: HTMLElement) =>
      Array.from(el.childNodes)
        .filter((n) => !(n instanceof HTMLElement && n.classList.contains("dc-heading-num")))
        .map((n) => n.textContent)
        .join("")
        .trim()
    setOutlineItems(heads.map((el) => ({ text: ownText(el), level: Number(el.tagName[1]) || 2 })))
    setActiveOutline(-1)

    if (!wide || kept.length === 0) {
      setNotes([])
      return
    }
    const measure = () => {
      const wrapRect = wrapper.getBoundingClientRect()
      const list: MarginNote[] = []
      for (const el of kept) {
        if (!el.isConnected) continue
        const idx = Number(el.dataset.concept)
        const c = conceptsRef.current[idx]
        if (!c) continue
        list.push({
          key: c.conceptKey || String(idx),
          idx,
          top: el.getBoundingClientRect().top - wrapRect.top,
          name: c.name,
          signal: c.signal,
        })
      }
      setNotes(layoutNotes(list))
    }
    measure()
    const scroller = scrollRef.current
    let last = 0
    const remeasure = () => {
      const now = Date.now()
      if (now - last < 250) return
      last = now
      measure()
    }
    scroller?.addEventListener("scroll", remeasure, { passive: true })
    window.addEventListener("resize", remeasure)
    return () => {
      scroller?.removeEventListener("scroll", remeasure)
      window.removeEventListener("resize", remeasure)
    }
    // Refs and the setter are stable; the DOM changes exactly when the reader does.
  }, [reader, displayMarkdown, wide])

  const numberedOutline = useMemo(() => numberOutlineItems(outlineItems, chapterKey), [outlineItems, chapterKey])

  useEffect(() => {
    const headNorms = outlineItems.map((it) => normHeading(it.text))
    const stamp = (el: HTMLElement, num: string) => {
      if (!num || el.dataset.numbered) return
      el.dataset.numbered = "1"
      const span = document.createElement("span")
      span.className = "dc-heading-num"
      span.textContent = num
      span.style.opacity = "0.45"
      span.style.fontVariantNumeric = "tabular-nums"
      span.style.marginRight = "0.45em"
      span.style.fontWeight = "500"
      el.prepend(span)
    }
    if (treeOutline.length) {
      const used = new Set<number>()
      const targets = treeOutline.map((item) => {
        const t = normHeading(item.title)
        if (!t) return -1
        for (let i = 0; i < headNorms.length; i++) {
          if (used.has(i)) continue
          const h = headNorms[i]
          if (h === t || h.startsWith(t) || t.startsWith(h)) {
            used.add(i)
            return i
          }
        }
        return -1
      })
      setRailTargets(targets)
      treeOutline.forEach((item, j) => {
        const el = targets[j] >= 0 ? headingEls.current[targets[j]] : null
        if (el) stamp(el, item.number)
      })
    } else {
      setRailTargets([])
      numberedOutline.forEach((it, i) => {
        const el = headingEls.current[i]
        if (el) stamp(el, it.num)
      })
    }
  }, [treeOutline, outlineItems, numberedOutline, headingEls])

  // Rail items: the canonical outline when the tree knows this chapter, else the
  // synthesized heading outline. `target` = rendered-heading index to jump to.
  const railItems: RailItem[] = useMemo(
    () =>
      treeOutline.length
        ? treeOutline.map((it, j) => ({
            key: `${it.sectionKey}-${j}`,
            number: it.number,
            text: it.title,
            depthPad: it.depth,
            target: railTargets[j] ?? -1,
          }))
        : numberedOutline.map((it, i) => ({
            key: `${it.text}-${i}`,
            number: it.num,
            text: it.text,
            depthPad: Math.max(0, it.level - 2),
            target: i,
          })),
    [treeOutline, railTargets, numberedOutline],
  )
  const activeRail = useMemo(
    () =>
      treeOutline.length
        ? railItems.reduce((acc, it, j) => (it.target >= 0 && it.target <= activeOutline ? j : acc), -1)
        : activeOutline,
    [treeOutline.length, railItems, activeOutline],
  )

  return { notes, railItems, activeRail }
}
