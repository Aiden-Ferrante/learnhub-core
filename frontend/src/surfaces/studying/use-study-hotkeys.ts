"use client"

import { useEffect, useRef } from "react"

/** THE study-surface hotkey listener — six panels used to hand-roll window keydown
 *  listeners with four subtly different input guards. This owns the one canonical guard
 *  (any INPUT/TEXTAREA/SELECT or contentEditable target is ignored — the union of what the
 *  copies guarded) and keeps the handler in a ref, so the listener registers ONCE per
 *  enable instead of re-registering every render (ConceptQuickCheck's copy re-registered
 *  on each render because its handler wasn't memoized). Key semantics stay in the caller. */
export function useStudyHotkeys(handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      ref.current(e)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled])
}
