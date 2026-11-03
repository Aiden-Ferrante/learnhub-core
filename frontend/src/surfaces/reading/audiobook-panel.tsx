"use client"

import { useEffect, useRef, useState } from "react"
import { Download, Headphones, Loader2, Play, RefreshCw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Progress } from "@/kit/ui/progress"
import { SectionCard } from "@/kit/patterns/section-card"
import { ErrorNotice } from "@/kit/data"
import { audiobookFileUrl } from "@/gateways/api/audiobook"
import { useAudiobook } from "@/surfaces/reading/use-audiobook"
import { useReadAlong } from "@/surfaces/reading/use-read-along"

type AudiobookPanelProps = {
  /** A chapter (toc:N) or section (toc:N.M) key, or null for the whole course. */
  scope: string | null
  /** learnDocId: content/concepts are keyed by it. */
  docId?: string
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // storage unavailable
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable
  }
}

/** Generate a chapter's narration as a downloadable MP3 (local Kokoro TTS), play it, and
 *  follow it in the text. Data lives in useAudiobook, the follower in useReadAlong. */
export function AudiobookPanel({ scope, docId }: AudiobookPanelProps) {
  const ab = useAudiobook(scope, docId)
  const [voice, setVoice] = useState("af_bella")

  // Playback speed (persisted) + resume position per scope.
  const audioRef = useRef<HTMLAudioElement>(null)
  const [speed, setSpeed] = useState(1)
  const [follow, setFollow] = useState(true)
  useEffect(() => {
    const s = Number(readStored("txt2k:audio-speed"))
    if (s >= 0.5 && s <= 3) setSpeed(s)
    setFollow(readStored("txt2k:audio-follow") !== "0")
  }, [])
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const timeline = ab.timelineQ.data ?? null
  const { buildSync } = useReadAlong(audioRef, timeline, follow)

  const posKey = `txt2k:audio-pos:${scope ?? ""}:text`
  const onAudioLoaded = () => {
    const el = audioRef.current
    if (!el) return
    el.playbackRate = speed
    const t = Number(readStored(posKey))
    if (t > 0 && t < el.duration - 2) el.currentTime = t
    buildSync() // estimated timelines need the real MP3 duration to scale their weights
  }
  const onAudioTime = () => {
    const el = audioRef.current
    if (el) writeStored(posKey, String(Math.floor(el.currentTime)))
  }

  if (!scope) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Pick a chapter from the outline to generate its audiobook.
      </p>
    )
  }

  const { status, ready, running } = ab
  const p = status.data?.progress
  const pct = p && p.total ? Math.round((100 * p.done) / p.total) : 0
  const fileUrl = ready ? `${audiobookFileUrl(scope, docId)}&_=${ab.cacheBust}` : ""
  const mins = status.data?.summary?.durationSec ? Math.max(1, Math.round(status.data.summary.durationSec / 60)) : null

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-2">
        <Headphones className="h-4 w-4 text-ink-accent" />
        <span className="text-sm font-medium">Audiobook</span>
        <span className="text-xs text-muted-foreground">· narrated locally by Kokoro</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Reads the chapter&rsquo;s text aloud (equations and code are skipped).
      </p>

      {status.status === "error" && (
        <ErrorNotice
          compact={status.data !== undefined}
          title="Couldn't reach the narrator"
          error={status.error}
          onRetry={status.retry}
        />
      )}

      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-label text-muted-foreground">Voice</span>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={running}
            className="block w-36 rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          >
            {ab.voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={() => ab.generate.fire(voice)} disabled={running || status.status === "loading"}>
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
      {ab.voicesQ.status === "error" && (
        <ErrorNotice compact title="Couldn't load the voices" error={ab.voicesQ.error} onRetry={ab.voicesQ.retry} />
      )}

      {ab.generate.error && (
        <ErrorNotice compact title="Not started" error={ab.generate.error} onRetry={() => ab.generate.fire(voice)} />
      )}
      {!ab.generate.error && (ab.startError ?? ab.runError) && (
        <p role="alert" className="text-sm text-ink-danger">
          {ab.startError ?? ab.runError}
        </p>
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
        <SectionCard bodyClassName="space-y-2 p-3">
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
                    writeStored("txt2k:audio-speed", String(v))
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
              <label
                className="flex cursor-pointer items-center gap-1"
                title={
                  timeline
                    ? "Highlight the narrated words in the text as they play"
                    : "No sync data for this narration — regenerate it to enable"
                }
              >
                <input
                  type="checkbox"
                  checked={follow && !!timeline}
                  disabled={!timeline}
                  onChange={(e) => {
                    setFollow(e.target.checked)
                    writeStored("txt2k:audio-follow", e.target.checked ? "1" : "0")
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
              href={audiobookFileUrl(scope, docId, true)}
              download
              className="inline-flex items-center gap-1 font-medium text-ink-accent hover:underline"
            >
              <Download className="h-3.5 w-3.5" />
              Download MP3
            </a>
          </div>
          {ab.timelineQ.status === "error" && (
            <ErrorNotice
              compact
              title="Couldn't load the read-along timing"
              error={ab.timelineQ.error}
              onRetry={ab.timelineQ.retry}
            />
          )}
        </SectionCard>
      )}
    </div>
  )
}
