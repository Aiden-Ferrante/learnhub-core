"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { qk, useApi } from "@/kit/data"
import { audiobookFileUrl, getAudiobookStatus } from "@/gateways/api/audiobook"

/** Narration for the open chapter: read along to the generated audiobook file.
 *  `useNarration` owns availability + open state (the header's Narrate button toggles it);
 *  `NarrationBar` is the mini-player: position/speed persist per chapter (shared with the
 *  Listen drawer's keys). Generation stays an explicit act: the bar only appears when
 *  this chapter's audio already exists.
 *
 *  Availability reads the same `qk.audiobookStatus` entry the Listen drawer shows, so a
 *  failed status read is reported (with Retry) there; here it only means no Narrate
 *  button, the way an optional side control fails. */
export function useNarration(chapterKey: string | null, docId: string) {
  const status = useApi(
    qk.audiobookStatus(docId, chapterKey),
    (signal) => getAudiobookStatus(chapterKey, docId, signal),
    { enabled: Boolean(chapterKey) },
  )
  // The player is open for one chapter; switching chapters closes it.
  const [openFor, setOpenFor] = useState<string | null>(null)
  const audioReady = status.data?.status === "done"
  const playerOpen = audioReady && openFor !== null && openFor === chapterKey

  return {
    audioReady,
    playerOpen,
    togglePlayer: () => setOpenFor((o) => (o === chapterKey ? null : chapterKey)),
  }
}

export function NarrationBar({
  chapterKey,
  docId,
  onClose,
}: {
  chapterKey: string
  docId: string
  onClose: () => void
}) {
  const [speed, setSpeed] = useState(1)
  const audioRef = useRef<HTMLAudioElement>(null)
  const saveAt = useRef(0)

  useEffect(() => {
    try {
      const s = Number(localStorage.getItem("txt2k:audio-speed"))
      if (s >= 0.5 && s <= 3) setSpeed(s)
    } catch {
      // storage unavailable
    }
  }, [])

  const cycleSpeed = () => {
    const steps = [1, 1.25, 1.5, 1.75, 2]
    const next = steps[(steps.indexOf(speed) + 1) % steps.length] ?? 1
    setSpeed(next)
    if (audioRef.current) audioRef.current.playbackRate = next
    try {
      localStorage.setItem("txt2k:audio-speed", String(next))
    } catch {
      // storage unavailable
    }
  }

  return (
    <div className="flex items-center gap-2 border-b bg-card/70 px-4 py-1.5">
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={audiobookFileUrl(chapterKey, docId)}
        className="h-8 min-w-0 flex-1 max-w-2xl"
        onLoadedMetadata={() => {
          const el = audioRef.current
          if (!el) return
          el.playbackRate = speed
          try {
            const t = Number(localStorage.getItem(`txt2k:audio-pos:${chapterKey}:text`))
            if (t > 0 && t < el.duration - 2) el.currentTime = t
          } catch {
            // storage unavailable
          }
        }}
        onTimeUpdate={() => {
          const el = audioRef.current
          if (!el) return
          const now = Date.now()
          if (now - saveAt.current < 2000) return
          saveAt.current = now
          try {
            localStorage.setItem(`txt2k:audio-pos:${chapterKey}:text`, String(Math.floor(el.currentTime)))
          } catch {
            // storage unavailable
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={cycleSpeed}
        className="h-6 px-1.5 text-xs tabular-nums text-muted-foreground"
        title="Playback speed"
      >
        {speed}×
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground"
        onClick={onClose}
        aria-label="Close narration"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
