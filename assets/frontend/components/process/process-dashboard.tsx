"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  Wand2,
  X,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cleanCourseTitle } from "@/lib/courses"
import {
  cancelChapterBuild,
  enqueueChapterBuild,
  fetchChapterBuilds,
  fetchChaptersReadiness,
  fetchCourseChapters,
  fetchLearnDocuments,
  type ChapterBuildJob,
  type ChapterReadiness,
  type CourseChapter,
  type LearnDocumentInfo,
  type SectionOutcome,
} from "@/lib/learn-service"
import { cn } from "@/lib/utils"

/** Processing dashboard — the extraction UI, rebuilt on the canonical pipeline:
 *  /api/chapters (one chapter list), /api/build/readiness (the ladder), and the
 *  chapter build queue (with per-section extraction outcomes). Replaces the
 *  legacy triple-era Process tab. */

function nextNightEpoch(): number {
  const d = new Date()
  d.setHours(2, 0, 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return Math.floor(d.getTime() / 1000)
}

function OutcomeReport({ job }: { job: ChapterBuildJob }) {
  const outcomes = job.outcomes ?? []
  const counts = useMemo(() => {
    const c = { ok: 0, empty: 0, error: 0, skipped: 0, gated: 0, chunked: 0 }
    for (const o of outcomes) {
      if (o.status === "ok") c.ok++
      else if (o.status === "empty") c.empty++
      else if (o.status === "error") c.error++
      else if (o.status === "skipped") c.skipped++
      if (o.gated) c.gated += o.gated
      if (o.chunks) c.chunked++
    }
    return c
  }, [outcomes])

  if (!outcomes.length) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        No extraction report — this build only refreshed the deep overlay (concepts already existed).
      </div>
    )
  }
  const noteworthy = outcomes.filter((o) => o.status !== "ok")
  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="text-nvidia-green">{counts.ok} extracted</span>
        {counts.empty > 0 && <span>{counts.empty} empty</span>}
        {counts.skipped > 0 && <span>{counts.skipped} skipped</span>}
        {counts.error > 0 && <span className="text-destructive">{counts.error} errors</span>}
        {counts.gated > 0 && <span className="text-amber-400">{counts.gated} gated (ungrounded)</span>}
        {counts.chunked > 0 && <span>{counts.chunked} chunked (oversize)</span>}
        {job.prereqEdges != null && <span>{job.prereqEdges} prereq edges</span>}
      </div>
      {noteworthy.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {noteworthy.map((o, i) => (
            <div key={`${o.sectionKey}-${i}`} className="flex items-start gap-2 text-xs">
              <span
                className={cn(
                  "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  o.status === "error" ? "bg-destructive" : o.status === "empty" ? "bg-amber-400" : "bg-muted-foreground/50",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-foreground/80" title={o.heading}>
                {o.heading}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {o.status === "skipped"
                  ? o.reason
                  : o.status === "empty"
                    ? o.gated
                      ? `all ${o.gated} gated`
                      : o.raw
                        ? "model kept none"
                        : "model returned none"
                    : o.error?.slice(0, 60)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProcessDashboard() {
  const [docs, setDocs] = useState<LearnDocumentInfo[]>([])
  const [docId, setDocId] = useState<string | null>(null)
  const [chapters, setChapters] = useState<CourseChapter[]>([])
  const [readiness, setReadiness] = useState<Record<string, ChapterReadiness>>({})
  const [builds, setBuilds] = useState<ChapterBuildJob[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busyScope, setBusyScope] = useState<string | null>(null)

  useEffect(() => {
    fetchLearnDocuments()
      .then((r) => {
        setDocs(r.documents || [])
        setDocId((cur) => cur ?? r.documents?.[0]?.docId ?? null)
      })
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!docId) return
    try {
      const ch = await fetchCourseChapters(docId)
      setChapters(ch.chapters || [])
      const keys = (ch.chapters || []).map((c) => c.key)
      const [r, b] = await Promise.all([
        keys.length ? fetchChaptersReadiness(docId, keys) : Promise.resolve({ chapters: {} }),
        fetchChapterBuilds(docId),
      ])
      setReadiness(r.chapters || {})
      setBuilds(b.builds || [])
    } catch {
      // transient — the poll retries
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    setLoading(true)
    setExpanded(null)
    load()
  }, [load])

  const anyActive = useMemo(
    () => builds.some((b) => b.status === "queued" || b.status === "running"),
    [builds],
  )
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [anyActive, load])

  const jobFor = useCallback(
    (scope: string) => builds.find((b) => b.scope === scope) ?? null,
    [builds],
  )

  const act = async (fn: () => Promise<unknown>, scope: string) => {
    setBusyScope(scope)
    try {
      await fn()
    } catch {
      // surfaced by reload
    }
    setBusyScope(null)
    load()
  }

  const unbuilt = chapters.filter((c) => (readiness[c.key]?.concepts ?? 0) === 0 && !jobFor(c.key))
  const deepCount = chapters.filter((c) => {
    const r = readiness[c.key]
    return r && r.concepts > 0 && r.explained >= r.concepts && r.briefing
  }).length

  const buildAllTonight = async () => {
    if (!docId || !unbuilt.length) return
    setBusyScope("__all__")
    const at = nextNightEpoch()
    for (const c of unbuilt) {
      try {
        await enqueueChapterBuild(docId, c.key, at)
      } catch {
        // continue queueing the rest
      }
    }
    setBusyScope(null)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-nvidia-green/15">
          <Zap className="h-4 w-4 text-nvidia-green" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">Process</h2>
          <p className="text-sm text-muted-foreground">
            Build each chapter&apos;s concept layer — extraction runs on your local model, one chapter at a time.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Book picker */}
      <div className="flex flex-wrap items-center gap-2">
        {docs.map((d) => (
          <button
            key={d.docId}
            type="button"
            onClick={() => setDocId(d.docId)}
            className={cn(
              "max-w-[22rem] truncate rounded-md border px-3 py-1.5 text-xs transition-colors",
              d.docId === docId
                ? "border-nvidia-green/50 bg-nvidia-green/10 text-foreground"
                : "text-muted-foreground hover:border-border hover:text-foreground",
            )}
            title={d.title}
          >
            {cleanCourseTitle(d.title).title}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-5/6" />
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {deepCount}/{chapters.length} chapters deep
            </span>
            {unbuilt.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={buildAllTonight}
                disabled={busyScope === "__all__"}
              >
                <Clock className="h-3.5 w-3.5" />
                Build all {unbuilt.length} unbuilt tonight · 2:00 AM
              </Button>
            )}
          </div>

          <div className="divide-y">
            {chapters.map((c) => {
              const r = readiness[c.key]
              const job = jobFor(c.key)
              const deep = r && r.concepts > 0 && r.explained >= r.concepts && r.briefing
              const partial = r && r.concepts > 0 && !deep
              const isOpen = expanded === c.key
              return (
                <div key={c.key}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setExpanded(isOpen ? null : c.key)}
                      title="Extraction report"
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        deep
                          ? "bg-nvidia-green"
                          : partial
                            ? "border border-nvidia-green bg-nvidia-green/30"
                            : "border border-muted-foreground/40",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm" title={c.title}>
                      {c.title}
                    </span>
                    <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                      {r ? `${r.concepts} concepts · ${r.explained}/${r.concepts || 0} deep` : "—"}
                    </span>

                    {job?.status === "running" ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {job.phase === "extract" && job.total
                          ? `extracting ${job.done}/${job.total}`
                          : job.phase === "deep"
                            ? "deep layer"
                            : "building"}
                      </span>
                    ) : job?.status === "queued" ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {job.notBefore
                          ? new Date(job.notBefore * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
                          : "queued"}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-foreground"
                          onClick={() => act(() => cancelChapterBuild(docId!, c.key), c.key)}
                          title="Cancel"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ) : job?.status === "error" ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-destructive" title={job.error ?? ""}>
                        <AlertTriangle className="h-3.5 w-3.5" /> failed
                      </span>
                    ) : deep ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-nvidia-green">
                        <Check className="h-3.5 w-3.5" /> deep
                      </span>
                    ) : null}

                    {(!job || job.status === "done" || job.status === "error") && !deep && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          disabled={busyScope === c.key}
                          onClick={() => act(() => enqueueChapterBuild(docId!, c.key, null), c.key)}
                        >
                          <Wand2 className="h-3 w-3" />
                          Build
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={busyScope === c.key}
                          onClick={() => act(() => enqueueChapterBuild(docId!, c.key, nextNightEpoch()), c.key)}
                          title="Schedule for tonight, 2:00 AM"
                        >
                          <Clock className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className="border-t bg-muted/20">
                      {job ? (
                        <OutcomeReport job={job} />
                      ) : (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          No build recorded for this chapter yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {chapters.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No chapters found — convert a document first (Upload).
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
