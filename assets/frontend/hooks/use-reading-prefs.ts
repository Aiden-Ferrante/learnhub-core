"use client"

import { useCallback, useEffect, useState } from "react"

export type ProseSize = "sm" | "base" | "lg" | "xl"
export type Measure = "narrow" | "normal" | "wide"
export type ReadingPrefs = { size: ProseSize; measure: Measure }

export const PROSE_SIZES: ProseSize[] = ["sm", "base", "lg", "xl"]

const KEY = "txt2k:reading-prefs"
const DEFAULT: ReadingPrefs = { size: "base", measure: "normal" }

/** Persisted reading preferences (text size + line width) shared by the book and section readers. */
export function useReadingPrefs(): [ReadingPrefs, (p: Partial<ReadingPrefs>) => void] {
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setPrefs({ ...DEFAULT, ...JSON.parse(raw) })
    } catch {
      // ignore malformed prefs
    }
  }, [])

  const update = useCallback((p: Partial<ReadingPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // storage may be unavailable; keep the in-memory value
      }
      return next
    })
  }, [])

  return [prefs, update]
}
