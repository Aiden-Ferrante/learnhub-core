"use client"

import { useCallback, useEffect, useState } from "react"

const keyFor = (docId?: string) => `txt2k:read:${docId || "latest"}`

/** Per-document set of sections the learner has marked as read (localStorage). Reading progress
 *  is intentionally separate from mastery (which is recall-based), so "read" ≠ "learned". */
export function useReadSections(docId?: string) {
  const [read, setRead] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const raw = localStorage.getItem(keyFor(docId))
      setRead(new Set<string>(raw ? JSON.parse(raw) : []))
    } catch {
      setRead(new Set())
    }
  }, [docId])

  const toggle = useCallback(
    (sectionKey: string) => {
      setRead((cur) => {
        const next = new Set(cur)
        if (next.has(sectionKey)) next.delete(sectionKey)
        else next.add(sectionKey)
        try {
          localStorage.setItem(keyFor(docId), JSON.stringify([...next]))
        } catch {
          // storage may be unavailable
        }
        return next
      })
    },
    [docId],
  )

  return { read, isRead: (k: string) => read.has(k), toggle, count: read.size }
}
