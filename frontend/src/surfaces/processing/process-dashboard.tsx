"use client"

/** Processing dashboard: the extraction UI on the canonical pipeline. The machine strip,
 *  a book picker over the learn service's documents, then that book's chapters
 *  (/api/chapters) beside its build queue (with per-section extraction outcomes). */

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { PageHeader } from "@/kit/patterns/page-header"
import { SectionCard } from "@/kit/patterns/section-card"
import { EmptyState } from "@/kit/patterns/empty-state"
import { AsyncView, ErrorNotice } from "@/kit/data"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import type { CourseChapter } from "@/gateways/api/chapter"
import type { ChapterBuildJob } from "@/gateways/api/pipeline"
import { MachineStrip } from "@/surfaces/processing/machine-strip"
import { ChapterBuildRow } from "@/surfaces/processing/chapter-build-row"
import { useBuilds, useChapterNames, useChapters, useLearnDocuments } from "@/surfaces/processing/use-process"

export function ProcessDashboard() {
  const docs = useLearnDocuments()
  const [picked, setPicked] = useState<string | null>(null)
  // The first book is the default pick until one is chosen.
  const docId = picked ?? docs.data?.documents[0]?.docId ?? null
  const chapters = useChapters(docId)
  const builds = useBuilds(docId)

  const refresh = () => {
    docs.retry()
    chapters.retry()
    builds.retry()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Process"
        description="Build each chapter's concept layer — extraction runs on your local model, one chapter at a time."
        actions={
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-micro" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Machine strip: Ollama, memory, queue state, the running job. */}
      <MachineStrip />

      <AsyncView
        q={docs}
        errorTitle="Couldn't load your books"
        isEmpty={(d) => d.documents.length === 0}
        empty={
          <EmptyState
            title="No books yet"
            description="Upload a PDF or Markdown file first; its chapters show up here to build."
          />
        }
      >
        {(d) => (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Book">
              {d.documents.map((doc) => (
                <Button
                  key={doc.docId}
                  type="button"
                  variant={doc.docId === docId ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 max-w-[22rem] text-micro"
                  aria-pressed={doc.docId === docId}
                  onClick={() => setPicked(doc.docId)}
                  title={doc.title}
                >
                  <span className="truncate">{cleanCourseTitle(doc.title).title}</span>
                </Button>
              ))}
            </div>
            {docId && <ChapterBuilds key={docId} docId={docId} chapters={chapters} builds={builds} />}
          </div>
        )}
      </AsyncView>
    </div>
  )
}

function ChapterBuilds({
  docId,
  chapters,
  builds,
}: {
  docId: string
  chapters: ReturnType<typeof useChapters>
  builds: ReturnType<typeof useBuilds>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <AsyncView
      q={chapters}
      errorTitle="Couldn't load the chapters"
      isEmpty={(d) => d.chapters.length === 0}
      empty={
        <EmptyState title="No chapters found" description="Convert a document first (Upload), then build its chapters here." />
      }
    >
      {(d) => (
        <ChapterList
          docId={docId}
          chapters={d.chapters}
          builds={builds}
          expanded={expanded}
          onToggle={(key) => setExpanded((cur) => (cur === key ? null : key))}
        />
      )}
    </AsyncView>
  )
}

function ChapterList({
  docId,
  chapters,
  builds,
  expanded,
  onToggle,
}: {
  docId: string
  chapters: CourseChapter[]
  builds: ReturnType<typeof useBuilds>
  expanded: string | null
  onToggle: (key: string) => void
}) {
  const names = useChapterNames(chapters)
  const jobs = new Map<string, ChapterBuildJob>()
  for (const b of builds.data?.builds ?? []) if (!jobs.has(b.scope)) jobs.set(b.scope, b)

  return (
    <SectionCard title={`${chapters.length} chapters`} bodyClassName="p-0">
      {/* The queue is a separate read: if it fails the chapters still list, with the
          reason and a Retry above them. */}
      {builds.status === "error" && (
        <ErrorNotice
          compact
          className="border-b px-3 py-2"
          title="Couldn't load the build queue"
          error={builds.error}
          onRetry={builds.retry}
        />
      )}
      <div className="divide-y">
        {chapters.map((c) => (
          <ChapterBuildRow
            key={c.key}
            docId={docId}
            chapter={c}
            name={names.get(c.key) ?? c.title}
            job={jobs.get(c.key) ?? null}
            open={expanded === c.key}
            onToggle={() => onToggle(c.key)}
          />
        ))}
      </div>
    </SectionCard>
  )
}
