"use client"

import { useEffect, useState } from "react"

const HIGHLIGHT_KEY = "txt2k:concept-highlight"

/** The concept highlighter wash preference (default on; the toggle lives in the Aa
 *  reading settings), persisted in localStorage. */
export function useConceptHighlight(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(true)
  useEffect(() => {
    try {
      setOn(localStorage.getItem(HIGHLIGHT_KEY) !== "0")
    } catch {
      // storage unavailable
    }
  }, [])
  const set = (v: boolean) => {
    setOn(v)
    try {
      localStorage.setItem(HIGHLIGHT_KEY, v ? "1" : "0")
    } catch {
      // storage unavailable
    }
  }
  return [on, set]
}

/** True when the screen has real margin for margin notes (≥ 1440px). */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1440px)")
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])
  return wide
}
