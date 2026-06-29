"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Download,
  FileText,
  GraduationCap,
  Headphones,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  audiobookFileUrl,
  fetchAudiobookVoices,
  getAudiobookStatus,
  startAudiobook,
  type AudiobookSource,
  type AudiobookStatusResponse,
} from "@/lib/learn-service"
import { cn } from "@/lib/utils"

type AudiobookPanelProps = {
  /** A chapter (toc:N) or section (toc:N.M) key, or null for the whole course. */
  scope: string | null
  /** learnDocId — content/concepts are keyed by it. */
  docId?: string
}

const SOURCES: { value: AudiobookSource; label: string; Icon: typeof FileText }[] = [
  { value: "text", label: "Full text", Icon: FileText },
  { value: "guided", label: "Guided", Icon: GraduationCap },
  { value: "concepts", label: "Concept summary", Icon: Sparkles },
]

const SOURCE_HINT: Record<AudiobookSource, string> = {
  text: "Reads the chapter's text aloud (equations and code are skipped).",
  guided: "A tutor reads the text and adds orientation, notes, and key takeaways — grounded in your concepts.",
  concepts: "Reads the extracted concept lessons — a clean audio summary.",
}

/** Generate a chapter's narration as a downloadable MP3 (local Orpheus TTS). */
export function AudiobookPanel({ scope, docId }: AudiobookPanelProps) {
  const [source, setSource] = useState<AudiobookSource>("text")
  const [voice, setVoice] = useState("tara")
  const [voices, setVoices] = useState<string[]>(["tara"])
  const [status, setStatus] = useState<AudiobookStatusResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [cacheBust, setCacheBust] = useState(0)
  const pollRef = useRef<number | null>(null)

  // Playback speed (persisted) + resume position per (scope, source).
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
  const posKey = `txt2k:audio-pos:${scope ?? ""}:${source}`
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
    const st = await getAudiobookStatus(scope, docId, source)
    setStatus(st)
    if (st.status === "running") {
      pollRef.current = window.setTimeout(poll, 4000)
    } else {
      setBusy(false)
      if (st.status === "done") setCacheBust(Date.now())
    }
  }, [scope, docId, source])

  // When scope/source changes, surface any already-generated file or resume a running job.
  useEffect(() => {
    stopPoll()
    setBusy(false)
    setStatus(null)
    getAudiobookStatus(scope, docId, source).then((st) => {
      setStatus(st)
      if (st.status === "running") {
        setBusy(true)
        pollRef.current = window.setTimeout(poll, 2000)
      } else if (st.status === "done") {
        setCacheBust(Date.now())
      }
    })
    return stopPoll
  }, [scope, docId, source, poll, stopPoll])

  const generate = async () => {
    setBusy(true)
    const started = await startAudiobook(scope, docId, source, voice)
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

  const ready = status?.status === "done"
  const running = status?.status === "running" || busy
  const p = status?.progress
  const pct = p && p.total ? Math.round((100 * p.done) / p.total) : 0
  const fileUrl = ready ? `${audiobookFileUrl(scope, docId, source)}&_=${cacheBust}` : ""
  const downloadUrl = audiobookFileUrl(scope, docId, source, true)
  const mins = status?.summary?.durationSec ? Math.max(1, Math.round(status.summary.durationSec / 60)) : null

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-2">
        <Headphones className="h-4 w-4 text-nvidia-green" />
        <span className="text-sm font-medium">Audiobook</span>
        <span className="text-xs text-muted-foreground">· narrated locally by Orpheus</span>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Narrate</span>
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
          {SOURCES.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSource(value)}
              disabled={running}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                source === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{SOURCE_HINT[source]}</p>
      </div>

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
            {p?.total
              ? `Narrating — segment ${p.done}/${p.total} (${pct}%)`
              : source === "guided"
                ? "Writing the guided script…"
                : "Preparing…"}
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
              <span>
                {mins ? `· ${mins} min` : ""}
                {source === "text" ? " · full text" : source === "concepts" ? " · concept summary" : ""}
              </span>
            </span>
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-1 font-medium text-nvidia-green hover:underline"
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
