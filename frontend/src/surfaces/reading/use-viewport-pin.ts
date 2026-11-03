"use client"

import { useEffect, type RefObject } from "react"

/** Pin an element's height to the rest of the viewport. The reading surfaces live inside
 *  the app's page-scrolling container; pinning lets the READER own the scroll (scroll
 *  persistence, margin notes and the sticky chrome all depend on the inner scroller).
 *  `active` = false skips it (e.g. before the element is mounted). */
export function useViewportPin(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    const size = () => {
      window.scrollTo(0, 0)
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top))
      el.style.height = `calc(100dvh - ${top}px - 12px)`
    }
    size()
    window.addEventListener("resize", size)
    return () => window.removeEventListener("resize", size)
  }, [ref, active])
}
