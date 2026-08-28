"use client"

import { useMemo } from "react"
import { useAsyncData } from "@/kit/hooks/use-async-data"
import {
  BookMarked,
  BookOpen,
  ChevronLeft,
  Dumbbell,
  Flame,
  GraduationCap,
  ListTree,
  PencilLine,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react"
import { SyllabusTree } from "@/surfaces/library/syllabus-tree"
import { StudyHeatmap } from "@/surfaces/library/study-heatmap"
import { ChapterStateStrip } from "@/surfaces/library/chapter-state-strip"
import { VersionMenu } from "@/surfaces/library/version-menu"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { fetchDocumentConcepts } from "@/gateways/api/concepts"
import { countSections, displaySectionTitle, findChapterForSection, findNodeBySectionKey, type LearnTreeNode } from "@/gateways/api/outline"
import { SectionCard } from "@/kit/patterns/section-card"
import { StatTile } from "@/kit/patterns/stat-tile"
import { fetchCourseStatus, type CoursePipelineStatus } from "@/gateways/api/pipeline"
import { type FadingSection, type MasteryResponse, type SectionMemory } from "@/gateways/api/progress"
import type { Course } from "@/surfaces/library/courses"
import type { CourseVersion } from "@/gateways/api/versions"

type CourseHomeProps = {
  course: Course
  tree: LearnTreeNode[]
  sectionCount: number
  loading: boolean
  error: string | null
  mastery: MasteryResponse | null
  onOpenSection: (scope: string | null, node: LearnTreeNode | null) => void
  onReview: (section: FadingSection) => void
  onReadBook: () => void
  onDeepRead?: () => void
  onViewConcepts: () => void
  /** Course-level structure drill (chapters → sections → concepts). */
  onSkeletonPractice?: () => void
  /** The practice session — work generated problems, self-graded on its own FSRS clock. */
  onPractice?: () => void
  /** Edit the words this course is built from. */
  onEditMaterial?: () => void
  /** The courses cut from this book, and which one is open. Omitted = no picker. */
  bookKey?: string
  versions?: CourseVersion[]
  activeVersion?: CourseVersion | null
  onVersionsChanged?: () => void
  /** Open one concept's detail (clicked as a leaf in the course outline). */
  onOpenConcept?: (conceptKey: string) => void
  /** Re-pull due count + mastery after a concept is ticked reviewed in the outline. */
  onConceptReviewed?: () => void
  onBackToShelf: () => void
  continueNode?: LearnTreeNode | null
  /** Reviews due now, or null when the debt read failed — "unknown", never "zero". */
  dueCount?: number | null
  onReviewAll?: () => void
  onRetry?: () => void
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() / 1000 - ts)
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/** One practice mode in the grouped "Practice" menu — its own identity line so the learner
 *  knows what it is and when to reach for it (vs. the guided path's in-chapter assessments). */
function PracticeTile({
  icon,
  title,
  desc,
  badge,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  badge?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors hover:border-brand/50 hover:bg-brand/5"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </span>
        {badge && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-micro font-medium tabular-nums text-muted-foreground">
            {badge}
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </button>
  )
}

export function CourseHome({
  course,
  tree,
  sectionCount,
  loading,
  error,
  mastery,
  onOpenSection,
  onReview,
  onReadBook,
  onDeepRead,
  onViewConcepts,
  onSkeletonPractice,
  onPractice,
  onEditMaterial,
  bookKey,
  versions,
  activeVersion,
  onVersionsChanged,
  onOpenConcept,
  onConceptReviewed,
  onBackToShelf,
  continueNode,
  dueCount = null,
  onReviewAll,
  onRetry,
}: CourseHomeProps) {
  const sectionsTotal = useMemo(() => countSections(tree), [tree])

  // Concept count is supplementary.
  const { data: conceptsData } = useAsyncData(() => fetchDocumentConcepts(course.learnDocId), [course.learnDocId])
  const conceptCount = conceptsData && !conceptsData.error ? conceptsData.concepts.length : null

  // Pipeline status: drives the hero progress strip AND tells the empty shell WHY it's
  // empty (dead content link vs no TOC vs simply not processed yet).
  const { data: pipeline } = useAsyncData(
    () => (course.learnDocId ? fetchCourseStatus(course.learnDocId) : null),
    [course.learnDocId],
  )

  // The strip's squares: top-level chapters + their memory summaries.
  const chapterRows = useMemo(() => {
    if (!mastery) return []
    return tree
      .filter((n) => n.isSection && n.sectionKey)
      .map((n) => ({ node: n, memory: mastery.bySection[n.sectionKey!] }))
      .filter((r): r is { node: LearnTreeNode; memory: SectionMemory } => !!r.memory)
  }, [tree, mastery])

  const overall = mastery?.overall ?? null
  const fadingSections = mastery?.fading ?? []
  const isEmpty = !loading && !error && tree.length === 0

  let headline: { icon: React.ReactNode; text: string }
  if (overall && overall.fading > 0) {
    headline = {
      icon: <Flame className="h-4 w-4 text-status-due" />,
      text: `${overall.fading} concept${overall.fading === 1 ? "" : "s"} are fading — review to bring them back.`,
    }
  } else if (!overall || overall.reviewed === 0) {
    headline = {
      icon: <Sparkles className="h-4 w-4 text-brand" />,
      text: "Pick any chapter below and start a review to begin tracking your memory.",
    }
  } else {
    headline = {
      icon: <Sparkles className="h-4 w-4 text-brand" />,
      text: "Everything you've studied is holding — keep the cadence going.",
    }
  }

  return (
    <div className="space-y-4">
      {/* Back breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToShelf}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to courses
        </button>
        <span className="text-sm font-medium">{course.title}</span>
      </div>

      {/* Hero — title, the ONE next action, then the numbers. */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold leading-tight tracking-tight">{course.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{course.description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {onDeepRead && !isEmpty && (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 px-3 text-xs"
                  onClick={onDeepRead}
                  title="Read on the guided reading surface"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  {continueNode
                    ? `Continue reading · ${displaySectionTitle(continueNode.label, continueNode.title)}`
                    : "Start reading"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatTile label="Sections" value={sectionsTotal} />
          <StatTile label="Concepts" value={conceptCount ?? "—"} />
          <StatTile
            label="Covered"
            value={overall ? `${overall.reviewed}/${overall.total}` : "—"}
          />
          <StatTile
            label="Retention"
            value={overall?.retention != null ? `${Math.round(overall.retention * 100)}%` : "—"}
          />
          {/* The fourth measure — can you USE it? Unknown (no items) renders as absence,
              never 0%: an absent measurement shown as a bad score is the lie the honesty
              arc exists to kill. Raw number, no solid/shaky words — those thresholds are
              calibrated for twenty-second cards, not worked problems. */}
          <StatTile
            label="Fluency"
            value={
              overall?.fluency?.fluency != null
                ? `${Math.round(overall.fluency.fluency * 100)}%`
                : "—"
            }
          />
        </div>

        {/* Pipeline strip: one status for the whole ingest→study pipeline, replacing the
            ambiguous KG-era "Processed" badge as the course's source of truth. */}
        {pipeline?.exists && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="text-brand">✓</span> Converted
              {pipeline.pageCount ? ` · ${pipeline.pageCount}p` : ""}
            </span>
            <span aria-hidden>·</span>
            {(pipeline.outlineEntries ?? 0) > 0 ? (
              <span className="flex items-center gap-1">
                <span className="text-brand">✓</span> Outline
              </span>
            ) : (
              <span className="text-status-due">No outline</span>
            )}
            <span aria-hidden>·</span>
            <span
              className={
                (pipeline.chaptersWithConcepts ?? 0) === (pipeline.chaptersTotal ?? 0) &&
                (pipeline.chaptersTotal ?? 0) > 0
                  ? "text-brand"
                  : undefined
              }
            >
              Concepts {pipeline.chaptersWithConcepts ?? 0}/{pipeline.chaptersTotal ?? 0} chapters
            </span>
          </div>
        )}

        {mastery && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            {headline.icon}
            <span>{headline.text}</span>
          </div>
        )}

      </div>

      {/* Practice — the review queue is the one cross-chapter practice surface. */}
      {!error && !isEmpty && onReviewAll && (
        <SectionCard
          title="Practice"
          description="Spaced review — strengthen what you already know."
          bodyClassName="p-3"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <PracticeTile
              icon={<RotateCcw className="h-4 w-4 text-brand" />}
              title="Review"
              desc="Spaced-repetition cards that have come due — keeps what you learned from fading."
              // null = the debt read failed. Saying "Caught up" there is the one wrong
              // answer, because it is the answer that makes someone skip their reviews.
              badge={dueCount === null ? "—" : dueCount > 0 ? `${dueCount} due` : "Caught up"}
              onClick={onReviewAll}
            />
          </div>
        </SectionCard>
      )}

      {/* Error state */}
      {error && (
        <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="text-destructive">{error}</p>
          <p className="text-muted-foreground">
            The course backend may still be starting — give it a moment and retry.
          </p>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Empty shell (no syllabus tree) — says WHY it's empty. Every failure here used to
          render the same generic message; the pipeline status distinguishes a dead content
          link (deleted/re-ingested doc) from a book with no TOC from plain not-processed. */}
      {isEmpty && (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center">
          <BookMarked className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          {!course.learnDocId ? (
            <>
              <p className="text-sm font-medium">This course has no learn content</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The document was added without a finished PDF conversion, so there is nothing
                to read or study yet. Re-upload the PDF on the Upload tab to build it.
              </p>
            </>
          ) : pipeline && !pipeline.exists ? (
            <>
              <p className="text-sm font-medium">Content link broken</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This course points at a document that no longer exists — it was likely deleted
                or replaced by a re-ingest. Re-upload the PDF to rebuild it (identical files
                are detected and linked automatically).
              </p>
            </>
          ) : pipeline?.exists && (pipeline.outlineEntries ?? 0) === 0 ? (
            <>
              <p className="text-sm font-medium">This PDF has no table of contents</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The reader still works, but a syllabus tree can&apos;t be built without PDF
                bookmarks. Concepts extracted per-section are still available:
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">No syllabus outline for this course</p>
              <p className="mt-1 text-sm text-muted-foreground">
                It may still be processing, or this book has no numbered table of contents. If
                you&apos;ve extracted concepts, view them directly:
              </p>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4 gap-1.5"
            onClick={onViewConcepts}
          >
            <Sparkles className="h-3.5 w-3.5" />
            View concepts
          </Button>
        </div>
      )}

      {/* Fading rail — studied sections whose retention dropped below the floor. */}
      {fadingSections.length > 0 && (
        <SectionCard title="Bring these back" bodyClassName="p-3">
          <div className="flex flex-wrap gap-2">
            {fadingSections.map((w) => (
              <button
                key={w.sectionKey}
                type="button"
                onClick={() => onReview(w)}
                className="group flex min-w-[11rem] flex-1 flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors hover:border-brand/50 hover:bg-brand/5"
              >
                <span className="text-xs text-muted-foreground">Fading — review</span>
                <span className="truncate text-sm font-medium">
                  {displaySectionTitle(w.label, w.title)}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  retention {w.retention != null ? `${Math.round(w.retention * 100)}%` : "—"}
                </span>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* The book across chapters (state strip), then you across time (heatmap). */}
      {!error && !isEmpty && (
        <ChapterStateStrip rows={chapterRows} bySection={mastery?.bySection ?? {}} onOpen={onOpenSection} />
      )}
      {!error && !isEmpty && <StudyHeatmap doc={course.learnDocId} />}

      {/* Course outline */}
      {!error && !isEmpty && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BookMarked className="h-3.5 w-3.5" />
              <span>Course outline</span>
              {!loading && sectionCount > 0 ? (
                <span className="tabular-nums text-muted-foreground/70">· {sectionCount} sections</span>
              ) : loading ? (
                <Skeleton className="h-3 w-12" />
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={onReadBook}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Read the book
              </Button>
              {bookKey && versions && onVersionsChanged && (
                <VersionMenu
                  bookKey={bookKey}
                  versions={versions}
                  activeVersion={activeVersion ?? null}
                  onChanged={onVersionsChanged}
                />
              )}
              {onDeepRead && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={onDeepRead}
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  Guided reading
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={onViewConcepts}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Concepts
                {conceptCount !== null && conceptCount > 0 && (
                  <span className="tabular-nums text-muted-foreground/70">· {conceptCount}</span>
                )}
              </Button>
              {onSkeletonPractice && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={onSkeletonPractice}
                >
                  <ListTree className="h-3.5 w-3.5" />
                  Skeleton practice
                </Button>
              )}
              {onPractice && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={onPractice}
                >
                  <Dumbbell className="h-3.5 w-3.5" />
                  Practice
                </Button>
              )}
              {onEditMaterial && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={onEditMaterial}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  Edit material
                </Button>
              )}
            </div>
          </div>
          <SyllabusTree
            tree={tree}
            selectedScope={null}
            onSelectScope={(scope) => {
              if (!scope) return
              // Studying is chapter-scoped: resolve any clicked section to its chapter.
              const chapter = findChapterForSection(tree, scope)
              if (chapter?.sectionKey) onOpenSection(chapter.sectionKey, chapter)
            }}
            masteryBySection={mastery?.bySection}
            loading={loading}
            docId={course.learnDocId}
            onSelectConcept={onOpenConcept}
            onConceptReviewed={onConceptReviewed}
            autoHeight
          />
        </div>
      )}
    </div>
  )
}
