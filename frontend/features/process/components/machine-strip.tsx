"use client"

import { useCallback, useEffect, useState } from "react"
import { Cpu, ListChecks, Loader2, MemoryStick, Pause, Play, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  cancelChapterBuild,
  fetchSystemStatus,
  setQueuePaused,
  type BuildKind,
  type SystemStatus,
} from "@/lib/learn-service"
import { cn } from "@/lib/utils"

const KIND_LABEL: Record<BuildKind, string> = {
  build: "Building",
  quizzes: "Authoring quizzes",
  guides: "Authoring guides",
  skeleton: "Skeleton",
  orient: "Orient",
}

function gb(bytes?: number | null): string {
  if (!bytes) return "0"
  return (bytes / 1024 ** 3).toFixed(bytes >= 100 * 1024 ** 3 ? 0 : 1)
}

/** Warm-until from Ollama's expires_at — how long the model stays resident. */
function warmLeft(expiresAt?: string): string | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const m = Math.round(ms / 60000)
  return m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`
}

/** Self-calibrating ETA: elapsed/done × remaining — no history needed, tightens as it runs. */
function etaLabel(startedAt?: number | null, done?: number, total?: number): string | null {
  if (!startedAt || !done || !total || done <= 0 || total <= done) return null
  const elapsed = Date.now() / 1000 - startedAt
  const left = (elapsed / done) * (total - done)
  const m = Math.max(1, Math.round(left / 60))
  return m >= 90 ? `~${(m / 60).toFixed(1)} h left` : `~${m} min left`
}

/** The machine strip: what Ollama has loaded, unified-memory pressure, queue state,
 *  and the one running job with live progress + ETA. Read-only except pause/cancel. */
export function MachineStrip() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await fetchSystemStatus()
      if (!s.error) setStatus(s)
    } catch {
      // transient — the poll retries
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const togglePause = async () => {
    if (!status) return
    setBusy(true)
    try {
      await setQueuePaused(!status.queue.paused)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const cancelRunning = async () => {
    const r = status?.queue.running
    if (!r) return
    setBusy(true)
    try {
      await cancelChapterBuild(r.docId, r.scope, r.kind)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null

  const model = status.ollama.models[0]
  const mem = status.memory
  const memPct = mem ? Math.min(100, Math.round((mem.usedBytes / mem.totalBytes) * 100)) : 0
  const running = status.queue.running
  const eta = running ? etaLabel(running.startedAt, running.done, running.total) : null
  const warm = warmLeft(model?.expiresAt)

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5" title="Model resident in Ollama right now">
          <Cpu className="h-3.5 w-3.5" />
          {status.ollama.ok ? (
            model ? (
              <>
                <span className="text-foreground/90">{model.name}</span>
                {model.sizeVram ? <span>· {gb(model.sizeVram)} GB</span> : null}
                {warm ? <span>· warm {warm}</span> : null}
              </>
            ) : (
              "no model loaded"
            )
          ) : (
            <span className="text-amber-400">Ollama unreachable</span>
          )}
        </span>

        {mem && (
          <span className="flex items-center gap-1.5" title="Unified memory (CPU + GPU share it)">
            <MemoryStick className="h-3.5 w-3.5" />
            <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <span
                className={cn(
                  "block h-full rounded-full",
                  memPct > 85 ? "bg-amber-400" : "bg-brand",
                )}
                style={{ width: `${memPct}%` }}
              />
            </span>
            {gb(mem.usedBytes)} / {gb(mem.totalBytes)} GB
          </span>
        )}

        <span className="flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" />
          {status.queue.queuedCount} queued
          {status.queue.scheduledCount > 0 && (
            <>
              {" "}· {status.queue.scheduledCount} scheduled
              {status.queue.nextScheduledAt && (
                <span>
                  {" "}(next{" "}
                  {new Date(status.queue.nextScheduledAt * 1000).toLocaleString([], {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  )
                </span>
              )}
            </>
          )}
        </span>

        <Button
          type="button"
          variant={status.queue.paused ? "outline" : "ghost"}
          size="sm"
          className={cn("ml-auto h-7 gap-1.5 px-2 text-xs", status.queue.paused && "text-amber-400")}
          onClick={togglePause}
          disabled={busy}
          title={
            status.queue.paused
              ? "Resume the queue — the worker starts claiming jobs again"
              : "Hold the queue — the running job finishes, nothing new starts"
          }
        >
          {status.queue.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {status.queue.paused ? "Queue paused — resume" : "Pause queue"}
        </Button>
      </div>

      {running && (
        <div className="flex items-center gap-3 border-t px-3 py-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">
                {KIND_LABEL[running.kind] ?? running.kind} · {running.chapterTitle ?? running.scope}
              </span>
              <span className="text-xs text-muted-foreground">
                {running.docTitle}
                {running.phase && running.total
                  ? ` · ${running.phase} ${running.done}/${running.total}`
                  : running.phase
                    ? ` · ${running.phase}`
                    : ""}
              </span>
            </div>
            {!!running.total && (
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${Math.round(((running.done ?? 0) / running.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
          {eta && <span className="shrink-0 text-xs text-muted-foreground">{eta}</span>}
          {running.cancelRequested ? (
            <span className="shrink-0 text-xs text-muted-foreground">stopping after this section…</span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={cancelRunning}
              disabled={busy}
              title="Stop after the current section — completed sections are kept"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
