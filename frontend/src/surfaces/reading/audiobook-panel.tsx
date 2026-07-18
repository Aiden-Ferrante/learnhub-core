"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Download, Headphones, Loader2, Play, RefreshCw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Progress } from "@/kit/ui/progress"
import { audiobookFileUrl, fetchAudiobookTimeline, fetchAudiobookVoices, getAudiobookStatus, startAudiobook, type AudiobookStatusResponse, type AudiobookTimeline } from "@/gateways/api/audiobook"
import {
  buildStripIndex,
  clearReadAlongHighlights,
  locateChunks,
  rangeFor,
  setHighlight,
  type ChunkSpan,
  type StripIndex,
} from "@/surfaces/reading/read-along"
import { cn } from "@/kit/lib/utils"

type AudiobookPanelProps = {
  /** A chapter (toc:N) or section (toc:N.M) key, or null for the whole course. */
  scope: string | null
  /** learnDocId — content/concepts are keyed by it. */
  docId?: string
}

/** Generate a chapter's narration as a downloadable MP3 (local Orpheus TTS). */
export function AudiobookPanel({ scope, docId }: AudiobookPanelProps) {
  const [voice, setVoice] = useState("tara")
  const [voices, setVoices] = useState<string[]>(["tara"])
  const [status, setStatus] = useState<AudiobookStatusResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [cacheBust, setCacheBust] = useState(0)
  const pollRef = useRef<number | null>(null)

  // Playback speed (persisted) + resume position per scope.
  const audioRef = useRef<HTMLAudioElement>(null)
  const [speed, setSpeed] = useState(1)
  useEffect(() => {
    try {
      const s = Number(localStorage.getItem("txt2k:audio-speed"))
      if (s >= 0.5 && s <= 3) setSpeed(s)
    } catch {
      /* storage unavailable */
    }
  }, [])
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])
  const posKey = `txt2k:audio-pos:${scope ?? ""}:text`
  const onAudioLoaded = () => {
    const el = audioRef.current
    if (!el) return
    el.playbackRate = speed
    try {
      const t = Number(localStorage.getItem(posKey))
      if (t > 0 && t < el.duration - 2) el.currentTime = t
    } catch {
      /* ignore */
    }
    buildSync() // estimated timelines need the real MP3 duration to scale their weights
  }
  const onAudioTime = () => {
    const el = audioRef.current
    if (!el) return
    try {
      localStorage.setItem(posKey, String(Math.floor(el.currentTime)))
    } catch {
      /* ignore */
    }
  }

  // ── Read-along: highlight what the narration is speaking, live in the prose ──
  const [follow, setFollow] = useState(true)
  useEffect(() => {
    try {
      setFollow(localStorage.getItem("txt2k:audio-follow") !== "0")
    } catch {
      /* ignore */
    }
  }, [])
  const [timeline, setTimeline] = useState<AudiobookTimeline | null>(null)
  // Chunk boundaries in seconds + located DOM spans, rebuilt when the timeline loads.
  const syncRef = useRef<{
    bounds: { start: number; end: number }[]
    spans: ChunkSpan[]
    index: StripIndex
    lastChunk: number
    lastWord: number
  } | null>(null)
  const rafRef = useRef<number | null>(null)

  const ready = status?.status === "done"

  useEffect(() => {
    setTimeline(null)
    syncRef.current = null
    clearReadAlongHighlights()
    if (!ready) return
    fetchAudiobookTimeline(scope, docId).then(setTimeline)
  }, [ready, scope, docId])

  // Resolve chunk times (exact, or weights scaled to the real MP3 duration) and locate each
  // chunk's span in the prose. The article lives behind this drawer in the deep chapter.
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
  }, [timeline])

  useEffect(() => {
    buildSync()
  }, [buildSync])

  // Follower while playing: sentence-chunk wash + an interpolated moving word. Driven by
  // the audio's `timeupdate` (~4 Hz — keeps working in a hidden tab, where rAF is fully
  // suspended) with an rAF loop on top for smooth word movement while the tab is visible.
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
          // Smooth scrolling is suspended in hidden tabs — jump instantly there instead.
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
  }, [follow, timeline])

  useEffect(() => {
    fetchAudiobookVoices().then((v) => {
      if (v.length) setVoices(v)
    })
  }, [])

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const poll = useCallback(async () => {
    const st = await getAudiobookStatus(scope, docId)
    setStatus(st)
    if (st.status === "running") {
      pollRef.current = window.setTimeout(poll, 4000)
    } else {
      setBusy(false)
      if (st.status === "done") setCacheBust(Date.now())
    }
  }, [scope, docId])

  // When scope changes, surface any already-generated file or resume a running job.
  useEffect(() => {
    stopPoll()
    setBusy(false)
    setStatus(null)
    getAudiobookStatus(scope, docId).then((st) => {
      setStatus(st)
      if (st.status === "running") {
        setBusy(true)
        pollRef.current = window.setTimeout(poll, 2000)
      } else if (st.status === "done") {
        setCacheBust(Date.now())
      }
    })
    return stopPoll
  }, [scope, docId, poll, stopPoll])

  const generate = async () => {
    setBusy(true)
    const started = await startAudiobook(scope, docId, voice)
    setStatus(started)
    if (started.status === "error") {
      setBusy(false)
      return
    }
    stopPoll()
    pollRef.current = window.setTimeout(poll, 2000)
  }

  if (!scope) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Pick a chapter from the outline to generate its audiobook.
      </p>
    )
  }

  const running = status?.status === "running" || busy
  const p = status?.progress
  const pct = p && p.total ? Math.round((100 * p.done) / p.total) : 0
  const fileUrl = ready ? `${audiobookFileUrl(scope, docId)}&_=${cacheBust}` : ""
  const downloadUrl = audiobookFileUrl(scope, docId, true)
  const mins = status?.summary?.durationSec ? Math.max(1, Math.round(status.summary.durationSec / 60)) : null

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-2">
        <Headphones className="h-4 w-4 text-brand" />
        <span className="text-sm font-medium">Audiobook</span>
        <span className="text-xs text-muted-foreground">· narrated locally by Orpheus</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Reads the chapter&rsquo;s text aloud (equations and code are skipped).
      </p>

      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Voice</span>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={running}
            className="block w-36 rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          >
            {voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={generate} disabled={running}>
          {running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : ready ? (
            <RefreshCw className="mr-2 h-4 w-4" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {running ? "Generating…" : ready ? "Regenerate" : "Generate audiobook"}
        </Button>
      </div>

      {status?.status === "error" && (
        <p className="text-sm text-destructive">{status.error || "Generation failed."}</p>
      )}

      {running && (
        <div className="space-y-1">
          <Progress value={pct} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {p?.total ? `Narrating — segment ${p.done}/${p.total} (${pct}%)` : "Preparing…"}
            <span className="ml-1 opacity-70">· a full chapter takes several minutes</span>
          </p>
        </div>
      )}

      {ready && (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={fileUrl}
            className="w-full"
            onLoadedMetadata={onAudioLoaded}
            onTimeUpdate={onAudioTime}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                Speed
                <select
                  value={speed}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setSpeed(v)
                    try {
                      localStorage.setItem("txt2k:audio-speed", String(v))
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="rounded border bg-background px-1 py-0.5 text-xs"
                >
                  {[0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-1" title={timeline ? "Highlight the narrated words in the text as they play" : "No sync data for this narration — regenerate it to enable"}>
                <input
                  type="checkbox"
                  checked={follow && !!timeline}
                  disabled={!timeline}
                  onChange={(e) => {
                    setFollow(e.target.checked)
                    try {
                      localStorage.setItem("txt2k:audio-follow", e.target.checked ? "1" : "0")
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="h-3 w-3 accent-brand"
                />
                Follow in text
              </label>
              <span>
                {mins ? `· ${mins} min` : ""}
                {" · full text"}
              </span>
            </span>
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
            >
              <Download className="h-3.5 w-3.5" />
              Download MP3
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
