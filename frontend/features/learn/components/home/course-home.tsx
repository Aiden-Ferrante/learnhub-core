"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  BookMarked,
  BookOpen,
  Brain,
  ChevronLeft,
  Clock,
  Flame,
  GraduationCap,
  History,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react"
import { SyllabusTree } from "@/features/learn/components/home/syllabus-tree"
import { StudyHeatmap } from "@/features/learn/components/home/study-heatmap"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchTodayPlan, type TodayPlan } from "@/features/learn/api/chapter"
import { fetchDocumentConcepts } from "@/features/learn/api/concepts"
import { countSections, displaySectionTitle, findChapterForSection, findNodeBySectionKey, type LearnTreeNode } from "@/features/learn/api/outline"
import { ProgressRing } from "@/components/patterns/progress-ring"
import { SectionCard } from "@/components/patterns/section-card"
import { StatTile } from "@/components/patterns/stat-tile"
import { enqueueChapterBuild, fetchCourseStatus, type CourseStatus } from "@/features/learn/api/pipeline"
import { fetchForecast, fetchMistakes, type ForecastResponse, type MasteryResponse, type Mistake, type WeakestSection } from "@/features/learn/api/progress"
import type { Course } from "@/features/learn/lib/courses"

type CourseHomeProps = {
  course: Course
  tree: LearnTreeNode[]
  edgeCount: number
  loading: boolean
  error: string | null
  mastery: MasteryResponse | null
  onOpenSection: (scope: string | null, node: LearnTreeNode | null) => void
  onReview: (section: WeakestSection) => void
  onReadBook: () => void
  onDeepRead?: () => void
  onViewConcepts: () => void
  /** Open one concept's detail (clicked as a leaf in the course outline). */
  onOpenConcept?: (conceptKey: string) => void
  onAsk?: () => void
  onBackToShelf: () => void
  continueNode?: LearnTreeNode | null
  onDrill?: () => void
  onBrainDump?: () => void
  dueCount?: number
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
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
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
  edgeCount,
  loading,
  error,
  mastery,
  onOpenSection,
  onReview,
  onReadBook,
  onDeepRead,
  onViewConcepts,
  onOpenConcept,
  onAsk,
  onBackToShelf,
  continueNode,
  onDrill,
  onBrainDump,
  dueCount = 0,
  onReviewAll,
  onRetry,
}: CourseHomeProps) {
  const sectionsTotal = useMemo(() => countSections(tree), [tree])
  const [mistakes, setMistakes] = useState<Mistake[]>([])

  useEffect(() => {
    let cancelled = false
    fetchMistakes(course.id, 5)
      .then((data) => {
        if (!cancelled && !data.error) setMistakes(data.mistakes)
      })
      .catch(() => {
        // mistakes are supplementary — a failure here must not break the page
      })
    return () => {
      cancelled = true
    }
  }, [course.id])

  const [conceptCount, setConceptCount] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchDocumentConcepts(course.learnDocId)
      .then((d) => {
        if (!cancelled && !d.error) setConceptCount(d.concepts.length)
      })
      .catch(() => {
        // concept count is supplementary
      })
    return () => {
      cancelled = true
    }
  }, [course.learnDocId])

  // Pipeline status: drives the hero progress strip AND tells the empty shell WHY it's
  // empty (dead content link vs no TOC vs simply not processed yet).
  const [pipeline, setPipeline] = useState<CourseStatus | null>(null)
  useEffect(() => {
    if (!course.learnDocId) {
      setPipeline(null)
      return
    }
    let cancelled = false
    fetchCourseStatus(course.learnDocId)
      .then((s) => {
        if (!cancelled) setPipeline(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [course.learnDocId])

  // Forgetting forecast — what's fading, so review becomes a daily, actionable habit.
  const [forecast, setForecast] = useState<ForecastResponse | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchForecast(course.learnDocId)
      .then((f) => {
        if (!cancelled && !f.error) setForecast(f)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [course.learnDocId])

  const { studied, needsReview } = useMemo(() => {
    const leaves = mastery
      ? Object.values(mastery.bySection).filter((m) => !m.isRollup)
      : []
    return {
      studied: leaves.filter((m) => m.attempts > 0).length,
      needsReview: leaves.filter((m) => m.attempts > 0 && m.mastery < 0.5).length,
    }
  }, [mastery])

  const overallPct = mastery ? Math.round(mastery.overall * 100) : 0
  const weakest = mastery?.weakest ?? []
  const isEmpty = !loading && !error && tree.length === 0

  // Course-level Today plan: resume chapter+stage, reviews due, next chapter to build.
  const [plan, setPlan] = useState<TodayPlan | null>(null)
  const [queueBusy, setQueueBusy] = useState(false)
  const planDocId = course.learnDocId ?? course.id
  const loadPlan = useCallback(() => {
    fetchTodayPlan(planDocId, continueNode?.sectionKey ?? null)
      .then((p) => {
        if (!p.error) setPlan(p)
      })
      .catch(() => {})
  }, [planDocId, continueNode?.sectionKey])

  useEffect(() => {
    loadPlan()
  }, [loadPlan])

  const queueTonight = async () => {
    if (!plan?.nextUnbuilt) return
    setQueueBusy(true)
    try {
      const d = new Date()
      d.setHours(2, 0, 0, 0)
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
      await enqueueChapterBuild(planDocId, plan.nextUnbuilt.key, Math.floor(d.getTime() / 1000))
    } catch {
      // surfaced by the next plan reload
    }
    setQueueBusy(false)
    loadPlan()
  }


  let headline: { icon: React.ReactNode; text: string }
  if (needsReview > 0) {
    headline = {
      icon: <Flame className="h-4 w-4 text-amber-500" />,
      text: `${needsReview} section${needsReview === 1 ? "" : "s"} have faded — review to bring them back.`,
    }
  } else if (studied === 0) {
    headline = {
      icon: <Sparkles className="h-4 w-4 text-brand" />,
      text: "Pick any section below and start a quiz to begin tracking mastery.",
    }
  } else {
    headline = {
      icon: <Sparkles className="h-4 w-4 text-brand" />,
      text: "You're on top of your material — keep the streak going.",
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
                  title={plan?.resume?.nextStage ? `Next up: ${plan.resume.nextStage.label}` : "Read on the deep chapter surface"}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  {plan?.resume
                    ? `Continue · ${plan.resume.title} — ${plan.resume.nextStage.label} (${plan.resume.stagesDone}/${plan.resume.stagesTotal})`
                    : continueNode
                      ? `Continue reading · ${displaySectionTitle(continueNode.label, continueNode.title)}`
                      : "Start reading"}
                </Button>
              )}
              {plan && plan.reviewsDue > 0 && onReviewAll && (
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={onReviewAll}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Review · {plan.reviewsDue} due
                </Button>
              )}
              {plan?.nextUnbuilt &&
                (plan.nextUnbuilt.build &&
                (plan.nextUnbuilt.build.status === "queued" || plan.nextUnbuilt.build.status === "running") ? (
                  <span className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground">
                    {plan.nextUnbuilt.build.status === "running" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )}
                    {plan.nextUnbuilt.title}
                    {plan.nextUnbuilt.build.status === "running"
                      ? " · building"
                      : plan.nextUnbuilt.build.notBefore
                        ? ` · ${new Date(plan.nextUnbuilt.build.notBefore * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                        : " · queued"}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 px-3 text-xs"
                    onClick={queueTonight}
                    disabled={queueBusy}
                    title={`${plan.nextUnbuilt.title} has no concept layer yet — schedule its build for tonight`}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Build “{plan.nextUnbuilt.title.length > 26 ? `${plan.nextUnbuilt.title.slice(0, 26)}…` : plan.nextUnbuilt.title}” tonight
                  </Button>
                ))}
            </div>
          </div>
          {mastery && <ProgressRing pct={overallPct} />}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Sections" value={sectionsTotal} />
          <StatTile label="Studied" value={mastery ? studied : "—"} />
          <StatTile label="Need review" value={mastery ? needsReview : "—"} />
          <StatTile label="Overall" value={mastery ? `${overallPct}%` : "—"} />
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
              <span className="text-amber-500">No outline</span>
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
            <span aria-hidden>·</span>
            <span>
              Quizzes {pipeline.chaptersWithQuizzes ?? 0}/{pipeline.chaptersTotal ?? 0}
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

      {/* Practice — strengthen what you already know. Distinct from the in-chapter assessments
          on the guided path: these are cross-chapter, self-directed, and ungraded. */}
      {!error && !isEmpty &&
        (onReviewAll || (onDrill && studied > 0) || (onBrainDump && (conceptCount ?? 0) > 0)) && (
          <SectionCard
            title="Practice"
            description="Cross-chapter, self-directed, ungraded — strengthen what you already know."
            bodyClassName="p-3"
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {onReviewAll && (
                <PracticeTile
                  icon={<RotateCcw className="h-4 w-4 text-brand" />}
                  title="Review"
                  desc="Spaced-repetition cards that have come due — keeps what you learned from fading."
                  badge={dueCount > 0 ? `${dueCount} due` : "Caught up"}
                  onClick={onReviewAll}
                />
              )}
              {onDrill && studied > 0 && (
                <PracticeTile
                  icon={<Target className="h-4 w-4 text-brand" />}
                  title="Drill weak spots"
                  desc="Adaptive multiple-choice on your weakest concepts — missed first, across all chapters."
                  onClick={onDrill}
                />
              )}
              {onBrainDump && (conceptCount ?? 0) > 0 && (
                <PracticeTile
                  icon={<Brain className="h-4 w-4 text-brand" />}
                  title="Free recall"
                  desc="Close the book and write what you remember about a chapter — then see your gaps."
                  onClick={onBrainDump}
                />
              )}
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

      {/* Study activity heatmap */}
      {!error && !isEmpty && forecast && (forecast.dueNow > 0 || (forecast.soon ?? 0) > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/15">
              <Flame className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {forecast.dueNow > 0
                  ? `${forecast.dueNow} concept${forecast.dueNow === 1 ? "" : "s"} due for review now`
                  : "You're caught up on reviews"}
              </p>
              <p className="text-xs text-muted-foreground">
                {(forecast.soon ?? 0) > 0
                  ? `${forecast.soon} more fade over the next 7 days — a few minutes keeps them fresh.`
                  : "Nothing else fades this week."}
              </p>
            </div>
          </div>
          {onReviewAll && forecast.dueNow > 0 && (
            <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={onReviewAll}>
              <RotateCcw className="h-3.5 w-3.5" />
              Review {forecast.dueNow} now
            </Button>
          )}
        </div>
      )}

      {!error && !isEmpty && <StudyHeatmap doc={course.id} />}

      {/* Review rail */}
      {weakest.length > 0 && (
        <SectionCard title="Pick up where you left off" bodyClassName="p-3">
          <div className="flex flex-wrap gap-2">
            {weakest.map((w) => {
              const pct = Math.round(w.mastery * 100)
              return (
                <button
                  key={w.sectionKey}
                  type="button"
                  onClick={() => onReview(w)}
                  className="group flex min-w-[11rem] flex-1 flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors hover:border-brand/50 hover:bg-brand/5"
                >
                  <span className="text-xs text-muted-foreground">Review section</span>
                  <span className="truncate text-sm font-medium">
                    {displaySectionTitle(w.label, w.title)}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
                  </div>
                </button>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* Recent mistakes */}
      {!error && !isEmpty && mistakes.length > 0 && (
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <History className="h-3.5 w-3.5" /> Recent mistakes
            </span>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y">
            {mistakes.map((m, i) => {
              const node = findNodeBySectionKey(tree, m.sectionKey)
              const sectionTitle = node
                ? displaySectionTitle(node.label, node.title)
                : displaySectionTitle(m.sectionKey)
              return (
                <button
                  key={`${m.sectionKey}-${m.ts}-${i}`}
                  type="button"
                  onClick={() =>
                    onReview({
                      sectionKey: m.sectionKey,
                      label: node?.label ?? m.sectionKey,
                      title: node?.title,
                      mastery: 0,
                    })
                  }
                  className="flex w-full items-baseline gap-3 px-3 py-2 text-left transition-colors hover:bg-brand/5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{sectionTitle}</div>
                    {m.stem && (
                      <div className="truncate text-xs text-muted-foreground">{m.stem}</div>
                    )}
                    {m.expected && (
                      <div className="truncate text-xs text-muted-foreground">
                        Answer: <span className="text-foreground/80">{m.expected}</span>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {relativeTime(m.ts)}
                  </span>
                </button>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* Course outline */}
      {!error && !isEmpty && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BookMarked className="h-3.5 w-3.5" />
              <span>Course outline</span>
              {!loading && edgeCount > 0 ? (
                <span className="tabular-nums text-muted-foreground/70">· {edgeCount} sections</span>
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
              {onDeepRead && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={onDeepRead}
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  Deep read
                </Button>
              )}
              {onAsk && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={onAsk}
                >
                  <Search className="h-3.5 w-3.5" />
                  Ask this book
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onOpenSection(null, null)}
              >
                Study whole course
              </Button>
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
            autoHeight
          />
        </div>
      )}
    </div>
  )
}
