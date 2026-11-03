"use client"

import { useCallback, useEffect, useRef, type RefObject } from "react"
import type { AudiobookTimeline } from "@/gateways/api/audiobook"
import {
  buildStripIndex,
  clearReadAlongHighlights,
  locateChunks,
  rangeFor,
  setHighlight,
  type ChunkSpan,
  type StripIndex,
} from "@/surfaces/reading/read-along"

type Sync = {
  bounds: { start: number; end: number }[]
  spans: ChunkSpan[]
  index: StripIndex
  lastChunk: number
  lastWord: number
}

/** Read-along: highlight what the narration is speaking, live in the prose behind the
 *  drawer. Resolves chunk times (exact, or weights scaled to the real MP3 duration),
 *  locates each chunk's span in the article, then follows playback with a sentence wash
 *  and an interpolated moving word. Driven by the audio's `timeupdate` (~4 Hz, which keeps
 *  working in a hidden tab, where rAF is suspended) with an rAF loop on top for smooth word
 *  movement while the tab is visible. Returns `buildSync` for the player's loadedmetadata
 *  (estimated timelines need the real duration). */
export function useReadAlong(
  audioRef: RefObject<HTMLAudioElement | null>,
  timeline: AudiobookTimeline | null,
  follow: boolean,
) {
  const syncRef = useRef<Sync | null>(null)
  const rafRef = useRef<number | null>(null)

  // A new timeline (or none) starts the sync over.
  useEffect(() => {
    syncRef.current = null
    clearReadAlongHighlights()
  }, [timeline])

  const buildSync = useCallback(() => {
    const el = audioRef.current
    const article = document.querySelector<HTMLElement>(".markdown-reader")
    if (!timeline || !el || !article || !Number.isFinite(el.duration) || !el.duration) return
    let bounds: { start: number; end: number }[]
    if (timeline.exact) {
      bounds = timeline.chunks.map((c) => ({ start: c.start ?? 0, end: c.end ?? 0 }))
    } else {
      const total = timeline.chunks.reduce((a, c) => a + (c.weight ?? 1), 0)
      let t = 0
      bounds = timeline.chunks.map((c) => {
        const dur = ((c.weight ?? 1) / total) * el.duration
        const b = { start: t, end: t + dur }
        t += dur
        return b
      })
    }
    const index = buildStripIndex(article)
    const spans = locateChunks(index, timeline.chunks.map((c) => c.text))
    syncRef.current = { bounds, spans, index, lastChunk: -1, lastWord: -1 }
  }, [timeline, audioRef])

  useEffect(() => {
    buildSync()
  }, [buildSync])

  useEffect(() => {
    const el = audioRef.current
    if (!el || !follow || !timeline) {
      clearReadAlongHighlights()
      return
    }
    const update = () => {
      const sync = syncRef.current
      if (!sync || el.paused) return
      const t = el.currentTime
      // Chunks are ordered; scan from the last known position (cheap either direction).
      let i = sync.lastChunk >= 0 ? sync.lastChunk : 0
      while (i > 0 && t < sync.bounds[i].start) i--
      while (i < sync.bounds.length - 1 && t >= sync.bounds[i + 1].start) i++
      const span = sync.spans[i]
      if (i !== sync.lastChunk) {
        sync.lastChunk = i
        sync.lastWord = -1
        setHighlight("txt2k-read-chunk", span ? rangeFor(sync.index, span.start, span.end) : null)
        if (span) {
          const r = rangeFor(sync.index, span.start, span.start + 1)
          const target = r?.startContainer.parentElement
          // Smooth scrolling is suspended in hidden tabs: jump instantly there instead.
          target?.scrollIntoView({
            block: "center",
            behavior: document.visibilityState === "visible" ? "smooth" : "auto",
          })
        }
      }
      if (span && span.wordStarts.length) {
        const { start, end } = sync.bounds[i]
        const frac = end > start ? Math.min(0.999, Math.max(0, (t - start) / (end - start))) : 0
        const w = Math.min(span.wordStarts.length - 1, Math.floor(frac * span.wordStarts.length))
        if (w !== sync.lastWord) {
          sync.lastWord = w
          setHighlight(
            "txt2k-read-word",
            rangeFor(sync.index, span.start + span.wordStarts[w], span.start + span.wordStarts[w] + span.wordLens[w]),
          )
        }
      }
    }
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)
      update()
    }
    // Coming back to the tab mid-chunk: force a fresh highlight + scroll to wherever the
    // narration has reached while the tab was hidden.
    const onVisible = () => {
      if (document.visibilityState === "visible" && syncRef.current) {
        syncRef.current.lastChunk = -1
        update()
      }
    }
    el.addEventListener("timeupdate", update)
    el.addEventListener("seeked", update)
    document.addEventListener("visibilitychange", onVisible)
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      el.removeEventListener("timeupdate", update)
      el.removeEventListener("seeked", update)
      document.removeEventListener("visibilitychange", onVisible)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      clearReadAlongHighlights()
    }
  }, [follow, timeline, audioRef])

  return { buildSync }
}
