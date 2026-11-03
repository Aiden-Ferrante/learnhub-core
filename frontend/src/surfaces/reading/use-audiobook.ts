"use client"

import { useEffect, useState } from "react"
import { qk, useApi, useApiMutation } from "@/kit/data"
import {
  getAudiobookStatus,
  requestAudiobookTimeline,
  requestAudiobookVoices,
  startAudiobook,
} from "@/gateways/api/audiobook"

/** af_bella is Kokoro's only A-graded English voice: the picker's value until /voices
 *  answers (and if it can't). */
const DEFAULT_VOICES = ["af_bella"]

/** Everything the Listen drawer fetches: the narration status (polled every 4 s while a
 *  job runs, so the panel rejoins a running job on open), the voice list, the read-along
 *  timeline once the audio exists, and the generate mutation. All keyed by doc + scope,
 *  so a scope change drops the old requests and the old poll. */
export function useAudiobook(scope: string | null, docId: string | undefined) {
  const status = useApi(
    qk.audiobookStatus(docId, scope),
    (signal) => getAudiobookStatus(scope, docId, signal),
    { enabled: Boolean(scope), poll: (d) => (d?.status === "running" ? 4000 : false) },
  )
  const voicesQ = useApi(qk.audiobookVoices(), (signal) => requestAudiobookVoices(signal), { staleMs: 5 * 60_000 })
  const voices = voicesQ.data?.length ? voicesQ.data : DEFAULT_VOICES

  const ready = status.data?.status === "done"
  const timelineQ = useApi(
    qk.audiobookTimeline(docId, scope),
    (signal) => requestAudiobookTimeline(scope, docId, signal),
    { enabled: Boolean(scope) && ready },
  )

  const generate = useApiMutation((voice: string) => startAudiobook(scope, docId, voice), {
    invalidates: [qk.audiobookStatus(docId, scope), qk.audiobookTimeline(docId, scope)],
  })

  // The MP3 URL changes whenever a (re)generated file lands, so the player never plays a
  // cached copy of the previous narration.
  const [cacheBust, setCacheBust] = useState(0)
  useEffect(() => {
    if (ready) setCacheBust(Date.now())
  }, [ready])

  // A 200 that carries an error body (the envelope) is a failed start too.
  const startError = generate.data?.status === "error" ? generate.data.error || "Generation failed." : null
  const runError = status.data?.status === "error" ? status.data.error || "Generation failed." : null
  const running = status.data?.status === "running" || generate.pending

  return { status, voices, voicesQ, ready, timelineQ, generate, cacheBust, startError, runError, running }
}
