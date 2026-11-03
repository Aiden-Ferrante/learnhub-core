/** Audiobook (TTS narration): generation, status, timeline for read-along, file URLs. */
import { parseJsonResponse } from './http'

// --------------------------------------------------------------------------- //
// Audiobook (Kokoro TTS) — generate a chapter's narration as a downloadable MP3.
// Note there is no 'interrupted' status: rendering a chapter takes seconds, so a run
// that dies has nothing worth resuming and simply reads as 'idle'.
// --------------------------------------------------------------------------- //

export type AudiobookStatusResponse = {
  status: 'idle' | 'running' | 'done' | 'error'
  scope?: string | null
  docId?: string
  progress?: { done: number; total: number; current?: string | null }
  summary?: {
    file?: string
    durationSec?: number
    segments?: number
    voice?: string
    exists?: boolean
  }
  error?: string
}

function audiobookParams(scope: string | null, doc?: string): URLSearchParams {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  return params
}

export async function startAudiobook(
  scope: string | null,
  doc: string | undefined,
  voice: string,
  signal?: AbortSignal,
): Promise<AudiobookStatusResponse> {
  const params = audiobookParams(scope, doc)
  const res = await fetch(`/api/learn/audiobook?${params}`, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice }),
  })
  return parseJsonResponse<AudiobookStatusResponse>(res)
}

export async function getAudiobookStatus(
  scope: string | null,
  doc: string | undefined,
  signal?: AbortSignal,
): Promise<AudiobookStatusResponse> {
  const params = audiobookParams(scope, doc)
  const res = await fetch(`/api/learn/audiobook/status?${params}`, { signal, cache: 'no-store' })
  return parseJsonResponse<AudiobookStatusResponse>(res)
}

export type AudiobookTimeline = {
  /** true = exact per-chunk seconds from synthesis; false = estimated weights the client
   *  scales to the real MP3 duration (narrations that predate timeline sidecars). */
  exact: boolean
  chunks: { text: string; start?: number; end?: number; weight?: number }[]
  error?: string
}

/** Chunk→playback-time map for read-along highlighting. Null when unavailable. */
export async function fetchAudiobookTimeline(
  scope: string | null,
  doc: string | undefined,
  signal?: AbortSignal,
): Promise<AudiobookTimeline | null> {
  try {
    const params = audiobookParams(scope, doc)
    const res = await fetch(`/api/learn/audiobook/timeline?${params}`, { signal, cache: 'no-store' })
    if (!res.ok) return null
    const data = await parseJsonResponse<AudiobookTimeline>(res)
    return data.error || !data.chunks?.length ? null : data
  } catch {
    return null
  }
}

/** URL for the generated MP3 — for the <audio> player (inline) or download (?download=1). */
export function audiobookFileUrl(
  scope: string | null,
  doc: string | undefined,
  download = false,
): string {
  const params = audiobookParams(scope, doc)
  if (download) params.set('download', '1')
  return `/api/learn/audiobook/file?${params}`
}

export async function fetchAudiobookVoices(signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch('/api/learn/audiobook/voices', { signal, cache: 'no-store' })
    const data = await parseJsonResponse<{ voices?: string[] }>(res)
    return data.voices || []
  } catch {
    return []
  }
}

/** The read-along timeline for `useApi`: null when this narration has no sync data (the
 *  route answers 404, or an empty chunk list), and a failed request THROWS (ApiError)
 *  instead of reading as "no timeline", so the panel can say so and offer Retry. */
export async function requestAudiobookTimeline(
  scope: string | null,
  doc: string | undefined,
  signal?: AbortSignal,
): Promise<AudiobookTimeline | null> {
  const params = audiobookParams(scope, doc)
  const res = await fetch(`/api/learn/audiobook/timeline?${params}`, { signal, cache: 'no-store' })
  if (res.status === 404) return null
  const data = await parseJsonResponse<AudiobookTimeline>(res)
  return data.error || !data.chunks?.length ? null : data
}

/** The narrator's voice list for `useApi`; a failed request throws (ApiError). */
export async function requestAudiobookVoices(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch('/api/learn/audiobook/voices', { signal, cache: 'no-store' })
  const data = await parseJsonResponse<{ voices?: string[] }>(res)
  return data.voices || []
}

