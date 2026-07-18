/** Audiobook (TTS narration): generation, status, timeline for read-along, file URLs. */
import { parseJsonResponse } from './http'

// --------------------------------------------------------------------------- //
// Audiobook (Orpheus TTS) — generate a chapter's narration as a downloadable MP3.
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
): Promise<AudiobookStatusResponse> {
  const params = audiobookParams(scope, doc)
  const res = await fetch(`/api/learn/audiobook?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice }),
  })
  return parseJsonResponse<AudiobookStatusResponse>(res)
}

export async function getAudiobookStatus(
  scope: string | null,
  doc: string | undefined,
): Promise<AudiobookStatusResponse> {
  const params = audiobookParams(scope, doc)
  const res = await fetch(`/api/learn/audiobook/status?${params}`, { cache: 'no-store' })
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
): Promise<AudiobookTimeline | null> {
  try {
    const params = audiobookParams(scope, doc)
    const res = await fetch(`/api/learn/audiobook/timeline?${params}`, { cache: 'no-store' })
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

export async function fetchAudiobookVoices(): Promise<string[]> {
  try {
    const res = await fetch('/api/learn/audiobook/voices', { cache: 'no-store' })
    const data = await parseJsonResponse<{ voices?: string[] }>(res)
    return data.voices || []
  } catch {
    return []
  }
}

