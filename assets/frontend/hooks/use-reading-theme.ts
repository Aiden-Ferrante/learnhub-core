"use client"

import { useCallback, useEffect, useState } from "react"

// Reading-surface theme for the book/notes readers (NOT the app's dark/light theme).
// "paper" = warm cream + serif for long reads; "dark" = the app's native dark prose.
export type ReadingTheme = "paper" | "dark"

const KEY = "reading-theme"
// Same-tab sync: the "storage" event only fires in OTHER tabs, so we also emit our own.
const EVENT = "reading-theme-change"

function readStored(): ReadingTheme {
  if (typeof window === "undefined") return "paper"
  return window.localStorage.getItem(KEY) === "dark" ? "dark" : "paper"
}

/** Persisted reading-surface theme, synced across every reader instance on the page. */
export function useReadingTheme(): [ReadingTheme, (next: ReadingTheme) => void] {
  // Start at the default so SSR and first client render agree; correct from storage in effect.
  const [theme, setThemeState] = useState<ReadingTheme>("paper")

  useEffect(() => {
    setThemeState(readStored())
    const sync = () => setThemeState(readStored())
    window.addEventListener(EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  const setTheme = useCallback((next: ReadingTheme) => {
    window.localStorage.setItem(KEY, next)
    setThemeState(next)
    window.dispatchEvent(new Event(EVENT))
  }, [])

  return [theme, setTheme]
}
