/** Process-owned pipeline reads: the build-console slices (machine strip, document
 *  list, build list) that only the Process dashboard consumes. The enqueue/cancel
 *  calls stay in learn (cross-feature via the hub allowlist). */

import { parseJsonResponse } from "@/gateways/api/http"
import type { BuildKind, ChapterBuildJob } from "@/gateways/api/pipeline"

export type LearnDocumentInfo = { docId: string; title: string; sourceFilename?: string }

export async function fetchLearnDocuments(): Promise<{ documents: LearnDocumentInfo[]; error?: string }> {
  const res = await fetch('/api/learn/documents', { cache: 'no-store' })
  return parseJsonResponse<{ documents: LearnDocumentInfo[] }>(res)
}

export async function fetchChapterBuilds(
  doc: string,
): Promise<{ docId?: string; builds: ChapterBuildJob[]; error?: string }> {
  const res = await fetch(`/api/learn/build?doc=${encodeURIComponent(doc)}`, { cache: 'no-store' })
  return parseJsonResponse<{ docId?: string; builds: ChapterBuildJob[] }>(res)
}

export type OllamaLoadedModel = {
  name: string
  size?: number
  sizeVram?: number
  expiresAt?: string
}

export type RunningJobInfo = {
  docId: string
  scope: string
  kind: BuildKind
  phase?: string | null
  done?: number
  total?: number
  startedAt?: number | null
  cancelRequested?: boolean | null
  docTitle?: string
  chapterTitle?: string
}

export type SystemStatus = {
  ollama: { ok: boolean; models: OllamaLoadedModel[]; error?: string }
  memory: { totalBytes: number; usedBytes: number } | null
  queue: {
    paused: boolean
    running: RunningJobInfo | null
    queuedCount: number
    scheduledCount: number
    nextScheduledAt: number | null
  }
}

export async function fetchSystemStatus(): Promise<SystemStatus & { error?: string }> {
  const res = await fetch('/api/learn/system', { cache: 'no-store' })
  return parseJsonResponse<SystemStatus>(res)
}

export async function setQueuePaused(paused: boolean): Promise<{ paused: boolean; error?: string }> {
  const res = await fetch('/api/learn/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  })
  return parseJsonResponse<{ paused: boolean }>(res)
}
