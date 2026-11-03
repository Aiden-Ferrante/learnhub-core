"use client"

/** One chapter on the Process dashboard: its name, its build state (running with live
 *  progress, queued or scheduled, failed), Build / Build tonight, cancel, and the
 *  expandable extraction report. */

import { useRef } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Loader2, Wand2, X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data"
import { nextNightEpoch } from "@/kit/lib/schedule"
import type { CourseChapter } from "@/gateways/api/chapter"
import type { ChapterBuildJob } from "@/gateways/api/pipeline"
import { OutcomeReport } from "@/surfaces/processing/outcome-report"
import { useCancelBuild, useEnqueueBuild } from "@/surfaces/processing/use-process"

function runningLabel(job: ChapterBuildJob): string {
  if (job.cancelRequested) return "stopping…"
  if (job.phase === "extract" && job.total) return `extracting ${job.done}/${job.total}`
  if (job.phase === "deep") return "deep layer"
  return "building"
}

function CancelButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="ml-0.5 h-5 w-5 hover:text-ink-danger [&_svg]:size-3"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <X />
    </Button>
  )
}

export function ChapterBuildRow({
  docId,
  chapter,
  name,
  job,
  open,
  onToggle,
}: {
  docId: string
  chapter: CourseChapter
  name: string
  job: ChapterBuildJob | null
  open: boolean
  onToggle: () => void
}) {
  const enqueue = useEnqueueBuild()
  const cancel = useCancelBuild()
  const busy = enqueue.pending || cancel.pending
  const settled = !job || job.status === "done" || job.status === "error" || job.status === "canceled"
  const failure = enqueue.error ?? cancel.error
  // The last write this row sent, so Retry repeats it rather than just dismissing it.
  const last = useRef<() => void>(() => {})
  const send = (write: () => void) => {
    enqueue.reset()
    cancel.reset()
    last.current = write
    write()
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground [&_svg]:size-3.5"
          onClick={onToggle}
          title="Extraction report"
          aria-label={open ? "Hide the extraction report" : "Show the extraction report"}
          aria-expanded={open}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <span className="min-w-0 flex-1 truncate text-meta" title={name}>
          {name}
        </span>

        {job?.status === "running" ? (
          <span className="flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {runningLabel(job)}
            {/* A running job is cancellable too: the runner checks cancelRequested at each
                section boundary, so finished sections are kept and no GPU work is thrown
                away mid-section. */}
            {!job.cancelRequested && (
              <CancelButton
                label="Stop this job — sections already finished are kept"
                disabled={busy}
                onClick={() => send(() => cancel.fire({ docId, scope: chapter.key, kind: job.kind }))}
              />
            )}
          </span>
        ) : job?.status === "queued" ? (
          <span className="flex shrink-0 items-center gap-1 text-micro text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {job.notBefore
              ? new Date(job.notBefore * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
              : "queued"}
            <CancelButton
              label="Cancel"
              disabled={busy}
              onClick={() => send(() => cancel.fire({ docId, scope: chapter.key, kind: job.kind }))}
            />
          </span>
        ) : job?.status === "error" ? (
          <span className="flex shrink-0 items-center gap-1 text-micro text-ink-danger" title={job.error ?? ""}>
            <AlertTriangle className="h-3.5 w-3.5" /> failed
          </span>
        ) : null}

        {settled &&
          (chapter.hasContent === false ? (
            // Same list as the course outline: content-less entries are shown (never
            // silently dropped) but can't be built.
            <span className="shrink-0 text-micro text-muted-foreground" title="This entry has no content to extract from">
              no content
            </span>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-micro [&_svg]:size-3"
                disabled={busy}
                onClick={() => send(() => enqueue.fire({ docId, scope: chapter.key, at: null }))}
              >
                <Wand2 />
                Build
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-micro [&_svg]:size-3"
                disabled={busy}
                onClick={() => send(() => enqueue.fire({ docId, scope: chapter.key, at: nextNightEpoch() }))}
                title="Schedule for tonight, 2:00 AM"
                aria-label="Build tonight at 2:00 AM"
              >
                <Clock />
              </Button>
            </div>
          ))}
      </div>
      {failure && (
        <ErrorNotice
          compact
          className="px-3 pb-2"
          title={enqueue.error ? "Not queued" : "Not cancelled"}
          error={failure}
          onRetry={() => send(last.current)}
        />
      )}
      {open && (
        <div className="border-t bg-muted/20">
          {job ? (
            <OutcomeReport job={job} docId={docId} />
          ) : (
            <p className="px-3 py-2 text-micro text-muted-foreground">No build recorded for this chapter yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
