"use client"

import { useMemo } from "react"
import { countSections, type LearnTreeNode } from "@/gateways/api/outline"
import type { CoursePipelineStatus } from "@/gateways/api/pipeline"
import type { SectionMemory } from "@/gateways/api/progress"
import { ErrorNotice } from "@/kit/data"
import { StatTile } from "@/kit/patterns/stat-tile"
import { Sheet } from "@/kit/study"
import { ChapterStateStrip } from "@/surfaces/library/chapter-state-strip"
import type { Course } from "@/surfaces/library/courses"
import { StudyHeatmap } from "@/surfaces/library/study-heatmap"
import type { CourseData } from "@/surfaces/library/use-course-data"
import type { CourseHomeData } from "@/surfaces/library/use-course-home"

/** One status for the whole ingest→study pipeline: converted, outline, concept coverage. */
function PipelineLine({ pipeline }: { pipeline: CoursePipelineStatus }) {
  const total = pipeline.chaptersTotal ?? 0
  const built = pipeline.chaptersWithConcepts ?? 0
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
      <span>
        <span className="text-ink-ok">✓</span> Converted{pipeline.pageCount ? ` · ${pipeline.pageCount}p` : ""}
      </span>
      <span aria-hidden>·</span>
      {(pipeline.outlineEntries ?? 0) > 0 ? (
        <span>
          <span className="text-ink-ok">✓</span> Outline
        </span>
      ) : (
        <span className="text-ink-warn">No outline</span>
      )}
      <span aria-hidden>·</span>
      <span className={total > 0 && built === total ? "text-ink-ok" : undefined}>
        Concepts {built}/{total} chapters
      </span>
    </p>
  )
}

/** The bottom of the course home, compact: the numbers, the pipeline line and the chapter
 *  strip in one sheet, then the activity heatmap. */
export function CourseStats({
  course,
  data,
  home,
  onOpenSection,
}: {
  course: Course
  data: CourseData
  home: CourseHomeData
  onOpenSection: (scope: string) => void
}) {
  const { tree, mastery } = data
  const sections = useMemo(() => countSections(tree), [tree])
  const overall = mastery?.overall ?? null
  // The strip's squares: top-level chapters with a memory summary.
  const chapterRows = useMemo(() => {
    if (!mastery) return []
    return tree
      .filter((n) => n.isSection && n.sectionKey)
      .map((n) => ({ node: n, memory: mastery.bySection[n.sectionKey!] }))
      .filter((r): r is { node: LearnTreeNode; memory: SectionMemory } => !!r.memory)
  }, [tree, mastery])
  const masteryQ = data.queries.mastery
  const pipelineQ = home.pipeline

  return (
    <>
      <Sheet title="Progress">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Sections" value={sections} />
          <StatTile label="Concepts" value={home.conceptCount ?? "—"} />
          <StatTile label="Covered" value={overall ? `${overall.reviewed}/${overall.total}` : "—"} />
          <StatTile
            label="Retention"
            value={overall?.retention != null ? `${Math.round(overall.retention * 100)}%` : "—"}
          />
        </div>
        {masteryQ.error && (
          <ErrorNotice compact title="Couldn't load your progress" error={masteryQ.error} onRetry={masteryQ.retry} />
        )}
        {pipelineQ.data?.exists && <PipelineLine pipeline={pipelineQ.data} />}
        {pipelineQ.error && (
          <ErrorNotice compact title="Couldn't load the course status" error={pipelineQ.error} onRetry={pipelineQ.retry} />
        )}
        <ChapterStateStrip rows={chapterRows} bySection={mastery?.bySection ?? {}} onOpen={onOpenSection} />
      </Sheet>
      <StudyHeatmap doc={course.learnDocId} />
    </>
  )
}
