"use client"

/** TRIAL (v0.31.5): which steps you have read to the end, kept in this browser.
 *  A step without concepts is complete once read; one with concepts once understood. */

import { useCallback, useEffect, useState } from "react"

const keyOf = (docId: string) => `lh-read-steps:${docId}`
const EVENT = "lh-read-steps"

function load(docId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(keyOf(docId)) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

export function useReadSteps(docId: string | undefined) {
  const [read, setRead] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!docId) return
    const sync = () => setRead(load(docId))
    sync()
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [docId])
  const markRead = useCallback(
    (sectionKey: string) => {
      if (!docId) return
      const s = load(docId)
      if (s.has(sectionKey)) return
      s.add(sectionKey)
      localStorage.setItem(keyOf(docId), JSON.stringify(Array.from(s)))
      window.dispatchEvent(new Event(EVENT))
    },
    [docId],
  )
  return { read, markRead }
}
