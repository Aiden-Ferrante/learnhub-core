"use client"

import { useEffect, useRef, useState } from "react"

/** The reader's scroll concern in one hook: per-chapter position persist/restore, the
 *  reading-progress percentage, the "resumed where you left off" chip, the outline
 *  scroll-spy, and the read-stage soft gate (reaching the chapter's tail marks it read).
 *
 *  Restore is synchronous (no rAF) — frames don't advance in hidden tabs, and the effect
 *  runs post-commit anyway. Cross-concern couplings are wired as params/returns, never
 *  shared refs: `onReadEnd` fires the stage machine, `getHeadings` reads the shell's
 *  rendered-heading list for the spy, `activeOutline` feeds the outline rail. */
export function useReaderScroll({
  scrollKey,
  contentReady,
  alreadyRead,
  onReadEnd,
  getHeadings,
}: {
  /** Per doc+chapter localStorage key — changing it resets progress/resumed/soft-gate. */
  scrollKey: string
  /** True once the chapter markdown is rendered (restore waits for it). */
  contentReady: boolean
  /** The read stage is already done — suppresses the soft gate. */
  alreadyRead: boolean
  onReadEnd: () => void
  getHeadings: () => HTMLElement[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [readPct, setReadPct] = useState(0)
  const [resumed, setResumed] = useState(false)
  const [activeOutline, setActiveOutline] = useState(-1)

  const scrollSaveAt = useRef(0)
  const spyAt = useRef(0)
  const readMarked = useRef(false)
  // Where the scroll-restore landed — the resumed chip dismisses once the reader
  // scrolls meaningfully away from it (they've chosen to read on).
  const restoredAt = useRef(0)
  // Last REAL reading position. When leaving a chapter the content unmounts first and the
  // browser clamps scrollTop to 0 before effect cleanups run — saving the live value there
  // would always persist 0. handleScroll keeps this ref honest (and ignores the clamp event,
  // which arrives while content is gone).
  const lastScrollTop = useRef(0)

  // Chapter switch: progress, chip, and the soft gate all start over.
  useEffect(() => {
    setReadPct(0)
    setResumed(false)
    readMarked.current = false
  }, [scrollKey])

  // Restore the saved position for this chapter once content is up, else start at top.
  // The cleanup writes the final position when leaving the chapter.
  useEffect(() => {
    const box = scrollRef.current
    if (!box || !contentReady) return
    const saved = Number(localStorage.getItem(scrollKey) || 0)
    box.scrollTop = saved
    lastScrollTop.current = box.scrollTop
    restoredAt.current = box.scrollTop
    if (saved > 400) setResumed(true)
    return () => {
      try {
        localStorage.setItem(scrollKey, String(Math.round(lastScrollTop.current)))
      } catch {
        // storage may be unavailable
      }
    }
  }, [contentReady, scrollKey])

  useEffect(() => {
    if (!resumed) return
    const t = setTimeout(() => setResumed(false), 6000)
    return () => clearTimeout(t)
  }, [resumed])

  const handleScroll = () => {
    const box = scrollRef.current
    if (!box || !contentReady) return
    lastScrollTop.current = box.scrollTop
    const denom = box.scrollHeight - box.clientHeight
    setReadPct(denom > 0 ? Math.min(100, Math.round((box.scrollTop / denom) * 100)) : 100)
    if (resumed && Math.abs(box.scrollTop - restoredAt.current) > 150) setResumed(false)
    // Read stage: reaching the tail of the chapter marks it read (soft gate).
    if (!readMarked.current && !alreadyRead && box.scrollTop + box.clientHeight >= box.scrollHeight * 0.92) {
      readMarked.current = true
      onReadEnd()
    }
    // Outline scroll-spy (throttled): the last heading above the reading line is "here".
    const spyNow = Date.now()
    const headings = getHeadings()
    if (spyNow - spyAt.current >= 150 && headings.length) {
      spyAt.current = spyNow
      const boxTop = box.getBoundingClientRect().top
      let idx = -1
      headings.forEach((el, i) => {
        if (el.getBoundingClientRect().top - boxTop <= 96) idx = i
      })
      setActiveOutline((cur) => (cur === idx ? cur : idx))
    }
    const now = Date.now()
    if (now - scrollSaveAt.current < 300) return
    scrollSaveAt.current = now
    try {
      localStorage.setItem(scrollKey, String(Math.round(box.scrollTop)))
    } catch {
      // storage may be unavailable
    }
  }

  return {
    scrollRef,
    readPct,
    resumed,
    dismissResumed: () => setResumed(false),
    activeOutline,
    setActiveOutline,
    handleScroll,
  }
}
