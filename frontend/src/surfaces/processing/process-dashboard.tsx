"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { MachineStrip } from "@/surfaces/processing/machine-strip"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { fetchCourseChapters, type CourseChapter } from "@/gateways/api/chapter"
import { numberSections, numberedSectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { deleteConcept, fetchSectionConcepts, type ConceptLesson } from "@/gateways/api/concepts"
import { cancelChapterBuild, enqueueChapterBuild, type ChapterBuildJob } from "@/gateways/api/pipeline"
import { fetchChapterBuilds, fetchLearnDocuments, type LearnDocumentInfo } from "@/gateways/api/system"
import { cn } from "@/kit/lib/utils"
import { usePolling } from "@/kit/hooks/use-polling"
import { nextNightEpoch } from "@/kit/lib/schedule"

/** Processing dashboard — the extraction UI on the canonical pipeline:
 *  /api/chapters (one chapter list) + the chapter build queue (with per-section
 *  extraction outcomes). */

/** The receipt's payload: what was actually extracted, inspectable and cullable in place.
 *  Junk concepts die here in one tap instead of surviving into reviews. */
function ConceptReceipt({ docId, scope }: { docId: string; scope: string }) {
  const [concepts, setConcepts] = useState<ConceptLesson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchSectionConcepts(scope, docId)
      .then((d) => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else setConcepts(d.concepts)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load concepts")
      })
    return () => {
      cancelled = true
    }
  }, [docId, scope])

  const remove = async (key: string) => {
    setBusyKey(key)
    try {
      const res = await deleteConcept(key)
      if (!res.error) {
        setConcepts((prev) => (prev ? prev.filter((c) => c.conceptKey !== key) : prev))
      }
    } finally {
      setBusyKey(null)
    }
  }

  if (error) {
    return <div className="px-3 py-2 text-xs text-destructive">{error}</div>
  }
  if (concepts === null) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading concepts…
      </div>
    )
  }
  if (!concepts.length) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">No concepts in this chapter.</div>
  }
  return (
    <div className="space-y-1 border-t px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">
        Extracted concepts · {concepts.length}
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {concepts.map((c) => (
          <div key={c.conceptKey ?? c.name} className="group flex items-start gap-2 text-xs">
            <span className="mt-0.5 shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
              {c.kind}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-foreground/90">{c.name}</span>
              <span className="text-muted-foreground"> — {c.signal}</span>
            </span>
            {c.conceptKey && (
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                title="Delete this concept (also removes its review history)"
                disabled={busyKey === c.conceptKey}
                onClick={() => remove(c.conceptKey!)}
              >
                {busyKey === c.conceptKey ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function OutcomeReport({ job, docId }: { job: ChapterBuildJob; docId: string }) {
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
      <div>
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No extraction report — this build only refreshed the deep overlay (concepts already existed).
        </div>
        <ConceptReceipt docId={docId} scope={job.scope} />
      </div>
    )
  }
  const noteworthy = outcomes.filter((o) => o.status !== "ok")
  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="text-brand">{counts.ok} extracted</span>
        {counts.empty > 0 && <span>{counts.empty} empty</span>}
        {counts.skipped > 0 && <span>{counts.skipped} skipped</span>}
        {counts.error > 0 && <span className="text-destructive">{counts.error} errors</span>}
        {counts.gated > 0 && <span className="text-amber-400">{counts.gated} gated (ungrounded)</span>}
        {counts.chunked > 0 && <span>{counts.chunked} chunked (oversize)</span>}
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
      <ConceptReceipt docId={docId} scope={job.scope} />
    </div>
  )
}

export function ProcessDashboard() {
  const [docs, setDocs] = useState<LearnDocumentInfo[]>([])
  const [docId, setDocId] = useState<string | null>(null)
  const [chapters, setChapters] = useState<CourseChapter[]>([])
  // Numbered display names via the SAME numberSections/numberedSectionTitle the
  // syllabus tree uses — the two surfaces render identical strings by construction.
  const chapterNames = useMemo(() => {
    const nodes: LearnTreeNode[] = chapters.map((c) => ({
      id: c.key,
      label: c.label || c.title,
      title: c.title,
      sectionKey: c.key,
      isSection: true,
      children: [],
    }))
    const numbers = numberSections(nodes)
    const out = new Map<string, string>()
    for (const n of nodes) out.set(n.id, numberedSectionTitle(numbers.get(n.id), n.label, n.title))
    return out
  }, [chapters])
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
      const b = await fetchChapterBuilds(docId)
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
  usePolling(load, anyActive ? 8000 : null)

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/15">
          <Zap className="h-4 w-4 text-brand" />
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

      {/* Machine strip: Ollama, memory, queue state, the running job. */}
      <MachineStrip />

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
                ? "border-brand/50 bg-brand/10 text-foreground"
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
              {chapters.length} chapters
            </span>
          </div>

          <div className="divide-y">
            {chapters.map((c) => {
              const job = jobFor(c.key)
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
                    <span className="min-w-0 flex-1 truncate text-sm" title={chapterNames.get(c.key) ?? c.title}>
                      {chapterNames.get(c.key) ?? c.title}
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
                    ) : null}

                    {(!job || job.status === "done" || job.status === "error" || job.status === "canceled") &&
                      (c.hasContent === false ? (
                        // Same list as the course outline — content-less entries are
                        // shown (never silently dropped) but can't be built.
                        <span className="shrink-0 text-xs text-muted-foreground" title="This entry has no content to extract from">
                          no content
                        </span>
                      ) : (
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
                      ))}
                  </div>
                  {isOpen && (
                    <div className="border-t bg-muted/20">
                      {job ? (
                        <OutcomeReport job={job} docId={docId!} />
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
