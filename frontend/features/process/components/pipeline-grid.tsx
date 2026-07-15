"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Clock, Loader2, Minus, RotateCcw, TriangleAlert, X } from "lucide-react"
import {
  cancelChapterBuild,
  enqueueChapterBuild,
  fetchCoverage,
  fetchJobsLedger,
  type BuildKind,
  type ChapterCoverage,
  type PipelineJobState,
  type PipelineLedgerRow,
} from "@/lib/learn-service"
import { cn } from "@/lib/utils"

/** Which queue kind a grid column's click enqueues. Audio is presence-only (narrations
 *  need a voice/source choice — that stays in the Listen drawer). */
const COLUMNS: { key: string; label: string; kind: BuildKind | null; hint: string }[] = [
  { key: "concepts", label: "Concepts", kind: "build", hint: "Extract this chapter's concepts (+ deep overlay)" },
  { key: "deep", label: "Deep", kind: "build", hint: "Briefing + per-concept deep explanations" },
  { key: "quizzes", label: "Quizzes", kind: "quizzes", hint: "Author application questions" },
  { key: "skeleton", label: "Skeleton", kind: "skeleton", hint: "Chapter essences (the memory scaffold)" },
  { key: "orient", label: "Orient", kind: "orient", hint: "Objectives + watch-fors" },
  { key: "guides", label: "Guides", kind: "guides", hint: "Per-section reading guidance" },
  { key: "audio", label: "Audio", kind: null, hint: "Generated narrations (made in the Listen drawer)" },
]

function jobBadge(job: PipelineJobState | undefined) {
  // Canceled reads like done in the grid — the cell shows the artifact's actual state.
  if (!job || job.status === "done" || job.status === "canceled") return null
  if (job.status === "queued")
    return (
      <span title={job.notBefore ? "scheduled" : "queued"}>
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    )
  if (job.status === "running")
    return (
      <span className="flex items-center gap-1 text-[10px] tabular-nums text-brand">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {job.total ? `${job.done}/${job.total}` : null}
      </span>
    )
  return (
    <span title={job.error || "failed"}>
      <TriangleAlert className="h-3.5 w-3.5 text-destructive" />
    </span>
  )
}

/** One coverage cell: current artifact state, overlaid with any queue activity, clickable
 *  to (re)build when there's something to do. */
function Cell({
  chapter,
  col,
  onBuild,
}: {
  chapter: ChapterCoverage
  col: (typeof COLUMNS)[number]
  onBuild: (scope: string, kind: BuildKind) => void
}) {
  const job = col.kind ? chapter.jobs[col.kind] : undefined
  const badge = jobBadge(job)

  let content: React.ReactNode
  let actionable = false
  let title = col.hint

  switch (col.key) {
    case "concepts":
      actionable = chapter.concepts === 0
      content = chapter.concepts > 0 ? (
        <span className="tabular-nums">{chapter.concepts}</span>
      ) : (
        <Minus className="h-3.5 w-3.5 opacity-40" />
      )
      break
    case "deep":
      actionable = chapter.concepts > 0 && !chapter.briefing
      content = chapter.briefing ? (
        <Check className="h-3.5 w-3.5 text-brand" />
      ) : (
        <Minus className="h-3.5 w-3.5 opacity-40" />
      )
      break
    case "quizzes": {
      const { authored, total } = chapter.quizzes
      actionable = total > 0 && authored < total
      content =
        total === 0 ? (
          <Minus className="h-3.5 w-3.5 opacity-40" />
        ) : authored >= total ? (
          <Check className="h-3.5 w-3.5 text-brand" />
        ) : (
          <span className={cn("tabular-nums", authored ? "text-amber-400" : "opacity-40")}>
            {authored}/{total}
          </span>
        )
      break
    }
    case "skeleton":
      actionable = chapter.skeleton !== "fresh" && chapter.sections > 0
      content =
        chapter.skeleton === "fresh" ? (
          <Check className="h-3.5 w-3.5 text-brand" />
        ) : chapter.skeleton === "stale" ? (
          <span className="text-[10px] font-medium uppercase text-amber-400">stale</span>
        ) : (
          <Minus className="h-3.5 w-3.5 opacity-40" />
        )
      break
    case "orient":
      actionable = !chapter.orient && chapter.sections > 0
      content = chapter.orient ? (
        <Check className="h-3.5 w-3.5 text-brand" />
      ) : (
        <Minus className="h-3.5 w-3.5 opacity-40" />
      )
      break
    case "guides": {
      const { authored, total } = chapter.guides
      actionable = total > 0 && authored < total
      content =
        total === 0 ? (
          <Minus className="h-3.5 w-3.5 opacity-40" />
        ) : authored >= total ? (
          <Check className="h-3.5 w-3.5 text-brand" />
        ) : (
          <span className={cn("tabular-nums", authored ? "text-amber-400" : "opacity-40")}>
            {authored}/{total}
          </span>
        )
      break
    }
    case "audio":
      title = chapter.audiobooks.length
        ? `Narrations: ${chapter.audiobooks.join(", ")}${chapter.readAlong ? " · read-along ready" : ""}`
        : col.hint
      content = chapter.audiobooks.length ? (
        <span className="text-[10px] uppercase text-brand">{chapter.audiobooks.length}</span>
      ) : (
        <Minus className="h-3.5 w-3.5 opacity-40" />
      )
      break
    default:
      content = null
  }

  const busy = job && (job.status === "queued" || job.status === "running")
  const clickable = !!col.kind && (actionable || job?.status === "error") && !busy

  return (
    <td className="px-1 py-1.5 text-center">
      <button
        type="button"
        disabled={!clickable}
        onClick={() => col.kind && onBuild(chapter.scope, col.kind)}
        title={clickable ? `${title} — click to build` : title}
        className={cn(
          "inline-flex h-7 min-w-9 items-center justify-center gap-1 rounded-md px-1.5",
          clickable && "border border-dashed border-border/60 hover:border-brand/60 hover:bg-brand/5",
          !clickable && "cursor-default",
        )}
      >
        {badge ?? content}
      </button>
    </td>
  )
}

function since(row: PipelineLedgerRow): string {
  if (row.startedAt && row.finishedAt) {
    const s = Math.max(1, Math.round(row.finishedAt - row.startedAt))
    return s >= 90 ? `${Math.round(s / 60)}m` : `${s}s`
  }
  return ""
}

function receiptLine(row: PipelineLedgerRow): string {
  const r = row.receipt || {}
  if (row.kind === "quizzes" || row.kind === "guides")
    return r.total != null ? `${r.authored}/${r.total} authored` : ""
  if (row.kind === "skeleton") return r.sections != null ? `${r.sections} essences` : ""
  if (row.kind === "orient") return r.objectives != null ? `${r.objectives} objectives` : ""
  if (row.kind === "build") {
    const c = (row as { concepts?: number }).concepts
    return c != null ? `${c} concepts` : ""
  }
  return ""
}

/**
 * The de-black-boxed pipeline: every chapter × every artifact with its live state — one
 * glance answers "what state is my library in", one click fixes a hole. Below it, the
 * ledger: what's running, what's queued, and what every past run produced.
 */
export function PipelineGrid({ docId }: { docId: string }) {
  const [chapters, setChapters] = useState<ChapterCoverage[] | null>(null)
  const [ledger, setLedger] = useState<PipelineLedgerRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [cov, jobs] = await Promise.all([fetchCoverage(docId), fetchJobsLedger(docId)])
      if (cov.error) setError(cov.error)
      else {
        setChapters(cov.chapters)
        setError(null)
      }
      if (!jobs.error) setLedger(jobs.builds || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "coverage unavailable")
    }
  }, [docId])

  useEffect(() => {
    setChapters(null)
    load()
  }, [load])

  const active = useMemo(
    () => ledger.filter((j) => j.status === "queued" || j.status === "running"),
    [ledger],
  )
  // Poll fast while jobs are active, slow when idle — jobs can be enqueued from
  // anywhere (course home, the MCP server), so the grid must notice them on its own.
  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = window.setInterval(load, active.length ? 6000 : 20000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [active.length, load])

  const build = useCallback(
    (scope: string, kind: BuildKind) => {
      enqueueChapterBuild(docId, scope, null, kind)
        .catch(() => {})
        .finally(load)
    },
    [docId, load],
  )

  const cancel = useCallback(
    (scope: string, kind: BuildKind) => {
      cancelChapterBuild(docId, scope, kind)
        .catch(() => {})
        .finally(load)
    },
    [docId, load],
  )

  const titleOf = useMemo(() => {
    const m = new Map((chapters ?? []).map((c) => [c.scope, c.title]))
    return (scope: string) => m.get(scope) || scope
  }, [chapters])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!chapters) return <p className="text-sm text-muted-foreground">Loading coverage…</p>
  if (!chapters.length) return null

  const history = [...ledger]
    .sort((a, b) => (b.requestedAt ?? 0) - (a.requestedAt ?? 0))
    .slice(0, 12)

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Chapter</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-1 py-2 text-center font-medium" title={c.hint}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chapters.map((ch) => (
              <tr key={ch.scope} className="border-b last:border-0 hover:bg-muted/20">
                <td className="max-w-56 truncate px-3 py-1.5" title={ch.title}>
                  {ch.title}
                </td>
                {COLUMNS.map((col) => (
                  <Cell key={col.key} chapter={ch} col={col} onBuild={build} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Dashed cells are buildable — one click queues the work (jobs run one at a time on the GPU).
      </p>

      {history.length > 0 && (
        <div className="rounded-lg border">
          <div className="border-b bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            Processing ledger {active.length > 0 && `· ${active.length} active`}
          </div>
          <ul className="divide-y">
            {history.map((j) => (
              <li key={`${j.key}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="w-16 shrink-0 font-medium uppercase text-muted-foreground">{j.kind}</span>
                <span className="min-w-0 flex-1 truncate" title={j.scope}>
                  {titleOf(j.scope)}
                </span>
                {j.status === "running" &&
                  (j.cancelRequested ? (
                    <span className="text-muted-foreground">stopping after this section…</span>
                  ) : (
                    <span className="flex items-center gap-1 text-brand">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {j.total ? `${j.done}/${j.total}` : "running"}
                      <button
                        type="button"
                        className="ml-0.5 text-muted-foreground hover:text-destructive"
                        onClick={() => cancel(j.scope, j.kind)}
                        title="Stop after the current section — completed sections are kept"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                {j.status === "queued" && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {j.notBefore ? `scheduled ${new Date(j.notBefore * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "queued"}
                    <button
                      type="button"
                      className="ml-0.5 hover:text-foreground"
                      onClick={() => cancel(j.scope, j.kind)}
                      title="Remove from queue"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {j.status === "done" && (
                  <span className="text-muted-foreground">
                    <span className="text-brand">done</span>
                    {receiptLine(j) && ` · ${receiptLine(j)}`}
                    {since(j) && ` · ${since(j)}`}
                  </span>
                )}
                {j.status === "canceled" && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    canceled{since(j) && ` · ${since(j)}`}
                    <button
                      type="button"
                      className="ml-0.5 hover:text-foreground"
                      onClick={() => build(j.scope, j.kind)}
                      title="Re-run — picks up where it left off (finished sections are skipped)"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {j.status === "error" && (
                  <span className="flex max-w-64 items-center gap-1 text-destructive">
                    <span className="truncate" title={j.error || undefined}>
                      {j.error || "failed"}
                    </span>
                    <button
                      type="button"
                      className="ml-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => build(j.scope, j.kind)}
                      title="Retry"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
