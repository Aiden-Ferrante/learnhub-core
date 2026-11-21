"use client"

/** The course page as chapter hubs (v0.31.4), from the "Overview D · Cards only" and
 *  "Chapter dashboard" boards on the LearnHub design canvas (2026-11-12), refined with the
 *  human on 2026-11-19. Replaced the tabbed Overview / Read / Review / Packs / Concepts.
 *
 *  - ChapterCards: Progress, Study activity, the comprehensive exam, then one card per top-level chapter (number,
 *    title, studied share, a red phone-app badge for what is due in it). The human
 *    asked for Progress and activity back on 2026-11-19 after trying the cards-only page.
 *  - The chapter page itself (ChapterDashboard) lives in chapter-path.tsx since 2026-11-19.
 *    Exam results are a browser-only design demo (demo-exams.ts) until v0.32.0.
 *
 *  Due counts come from ONE whole-course review queue, bucketed by chapter through the tree,
 *  never one request per card (that exhausted the API's pool in v0.31.1). */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { displaySectionTitle, numberSections, type LearnTreeNode } from "@/gateways/api/outline"
import type { SectionMemory } from "@/gateways/api/progress"
import { fetchCourseReviewQueue } from "@/gateways/api/review"
import { qk, useApi } from "@/kit/data"
import { cn } from "@/kit/lib/utils"
import { ChapterCardMenu, extractionLine, useChapterExtractions } from "@/surfaces/library/chapter-card-menu"
import { GroupHeader, GroupNameDialog } from "@/surfaces/library/chapter-group-ui"
import { addGroup, layoutSections, moveChapter, moveGroup, removeGroup, renameGroup } from "@/surfaces/library/chapter-groups"
import { useChapterGroups } from "@/surfaces/library/use-chapter-groups"
import { CourseStats } from "@/surfaces/library/course-stats"
import { coverColor } from "@/surfaces/library/cover"
import { PASS_MARK, useDemoExams, type ExamRecord } from "@/surfaces/library/demo-exams"
import { StudyHeatmap } from "@/surfaces/library/study-heatmap"
import type { CourseData } from "@/surfaces/library/use-course-data"
import { useCourseHome } from "@/surfaces/library/use-course-home"

const COURSE_LIMIT = 200

export function contains(node: LearnTreeNode, key: string): boolean {
  return node.sectionKey === key || node.children.some((c) => contains(c, key))
}

/** The heading without a leading number or dash: the card and header show the number big. */
export function plainTitle(node: LearnTreeNode): string {
  return displaySectionTitle(node.label, node.title).replace(/^\s*\d+(\.\d+)*\s*[.:)]?\s*/, "").replace(/^[\s–—-]+/, "")
}

export function pct(m: SectionMemory | undefined): number {
  return m && m.total > 0 ? Math.round(m.coverage * 100) : 0
}

/** The course page (the cards) or one chapter's hub. */
export function chaptersHref(courseId: string, chapterKey?: string): string {
  return chapterKey ? `/courses/${courseId}/chapters/${encodeURIComponent(chapterKey)}` : `/courses/${courseId}`
}

/** Top-level chapters, and the number the outline shows for each (none for front matter). */
export function useChapters(tree: LearnTreeNode[]) {
  return useMemo(() => {
    const numbers = numberSections(tree)
    return { chapters: tree.filter((n) => n.isSection && n.sectionKey), numbers }
  }, [tree])
}

/** Due cards per node key (chapters, or a chapter's sections), from one whole-course queue. */
export function useDueByChapter(docId: string | undefined, chapters: LearnTreeNode[]) {
  const q = useApi(
    qk.courseReview(docId ?? ""),
    (signal) => fetchCourseReviewQueue(docId ?? "", COURSE_LIMIT, signal),
    { enabled: Boolean(docId) },
  )
  return useMemo(() => {
    const out = new Map<string, number>()
    for (const card of q.data?.cards ?? []) {
      const ch = chapters.find((c) => contains(c, card.sectionKey))
      if (ch?.sectionKey) out.set(ch.sectionKey, (out.get(ch.sectionKey) ?? 0) + 1)
    }
    return out
  }, [q.data, chapters])
}

export function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-label={`${count} to review`}
      className="absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full bg-destructive px-1.5 text-xs font-bold text-destructive-foreground ring-[3px] ring-background"
    >
      {count}
    </span>
  )
}

export function Bar({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <div className={cn("h-1 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full" style={{ width: `${value}%`, background: color }} />
    </div>
  )
}

function ExamLine({ rec }: { rec: ExamRecord | undefined }) {
  if (!rec) return <span className="text-meta text-muted-foreground">Exam not taken</span>
  if (rec.passed) return <span className="text-meta font-medium text-ink-ok">✓ Exam passed · {rec.best}%</span>
  return <span className="text-meta text-ink-warn">Exam {rec.last}% · needs {PASS_MARK}%</span>
}

export function DemoControls({ onScore, label }: { onScore: (score: number) => void; label: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-meta text-muted-foreground">
      <span>Demo · {label}:</span>
      {[92, 84, 61].map((score) => (
        <button
          key={score}
          type="button"
          onClick={() => onScore(score)}
          className="rounded-md border border-border px-2 py-0.5 tabular-nums hover:border-muted-foreground/50 hover:text-foreground"
        >
          score {score}%
        </button>
      ))}
    </div>
  )
}

function ComprehensiveCard({
  exams,
  examChapters,
  numbers,
  color,
}: {
  exams: ReturnType<typeof useDemoExams>
  examChapters: LearnTreeNode[]
  numbers: Map<string, string>
  color: string
}) {
  const passed = examChapters.filter((c) => exams.chapters[c.sectionKey!]?.passed)
  const label = (keys: string[]) =>
    examChapters
      .filter((c) => keys.includes(c.sectionKey!))
      .map((c) => numbers.get(c.id))
      .join(", ")
  const comp = exams.comprehensive
  const fresh = passed.filter((c) => !comp?.covered.includes(c.sectionKey!)).length
  const complete =
    passed.length === examChapters.length && examChapters.length > 0 && comp?.passed && fresh === 0
  const locked = passed.length === 0

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl border bg-card p-5",
        locked ? "border-dashed border-border" : "border-border",
      )}
      style={!locked ? { borderColor: color } : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Comprehensive exam</span>
        <span className="text-meta text-muted-foreground">
          {passed.length} of {examChapters.length} chapters passed
        </span>
      </div>
      {locked ? (
        <p className="font-semibold text-muted-foreground">🔒 Pass any chapter exam to unlock it.</p>
      ) : (
        <>
          <p className="font-semibold">
            {complete ? "✓ Course complete" : `Covers chapter${passed.length === 1 ? "" : "s"} ${label(passed.map((c) => c.sectionKey!))}`}
          </p>
          <p className="text-meta text-muted-foreground">
            {comp
              ? comp.passed
                ? `Passed at ${comp.best}% for chapters ${label(comp.covered)}${fresh ? ` · ${fresh} newly passed chapter${fresh === 1 ? "" : "s"} not yet covered` : ""}`
                : `Last try ${comp.last}% · needs ${PASS_MARK}%`
              : `Pass mark ${PASS_MARK}% · grows as you pass chapters`}
          </p>
          <button
            type="button"
            className="mt-1 self-start rounded-lg bg-primary px-3.5 py-2 text-meta font-semibold text-primary-foreground"
          >
            {comp ? "Retake comprehensive exam" : "Take comprehensive exam"}
          </button>
          <DemoControls label="comprehensive result" onScore={exams.sitComprehensive} />
        </>
      )}
    </div>
  )
}


export function ChapterCards({ data }: { data: CourseData }) {
  const course = data.course!
  const color = coverColor(course.title)
  const { chapters, numbers } = useChapters(data.tree)
  const due = useDueByChapter(course.learnDocId, chapters)
  const by = data.mastery?.bySection ?? {}
  const home = useCourseHome(course, data)
  const exams = useDemoExams(course.id)
  const examChapters = chapters.filter((c) => numbers.get(c.id))
  const router = useRouter()
  const extraction = useChapterExtractions(course.learnDocId)
  const chapterKeys = useMemo(() => chapters.map((c) => c.sectionKey!), [chapters])
  const cg = useChapterGroups(course.id, course.learnDocId, chapterKeys)
  const sections = useMemo(() => layoutSections(chapters, cg.groups), [chapters, cg.groups])
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [naming, setNaming] = useState<
    { mode: "new"; chapterKey?: string } | { mode: "rename"; id: string; name: string } | null
  >(null)

  const renderCard = (c: LearnTreeNode, groupId: string | null) => {
    const num = numbers.get(c.id)
    const share = pct(by[c.sectionKey!])
    const n = due.get(c.sectionKey!) ?? 0
    const job = extraction.job(c.sectionKey!)
    const line = extractionLine(job)
    const running = job?.status === "running" || job?.status === "queued"
    return (
      // The menu sits beside the card's link, not inside it (no button inside a link).
      <div key={c.id} className="relative transition hover:-translate-y-0.5">
        <ChapterCardMenu
          title={num ? `Chapter ${num} · ${plainTitle(c)}` : plainTitle(c)}
          running={running}
          onExtract={() => extraction.start.fire(c.sectionKey!)}
          groups={cg.ready ? cg.groups.map((g) => ({ id: g.id, name: g.name })) : undefined}
          groupId={groupId}
          onMove={cg.ready ? (gid) => cg.update((gs) => moveChapter(gs, c.sectionKey!, gid)) : undefined}
          onNewGroup={() => setNaming({ mode: "new", chapterKey: c.sectionKey! })}
        />
        <Link
          href={chaptersHref(course.id, c.sectionKey!)}
          className="relative flex h-full min-h-[180px] flex-col gap-3 rounded-2xl border border-border bg-card p-[18px] hover:border-muted-foreground/50"
        >
          <Badge count={n} />
          <span
            className={cn("font-serif text-[44px] font-semibold leading-none", !(n > 0 || share > 0) && "text-muted-foreground/50")}
            style={n > 0 || share > 0 ? { color } : undefined}
          >
            {num ?? "·"}
          </span>
          <span className="flex-1 text-[15px] font-semibold leading-snug">{plainTitle(c)}</span>
          <span className="flex flex-col gap-1.5">
            <span className="text-meta tabular-nums text-muted-foreground">{share}% studied</span>
            <Bar value={share} color={color} />
            {num ? <ExamLine rec={exams.chapters[c.sectionKey!]} /> : <span className="text-meta text-muted-foreground/60">No exam</span>}
            {line && <span className={cn("text-meta", job?.status === "error" ? "text-ink-danger" : "text-ink-accent")}>{line}</span>}
          </span>
        </Link>
      </div>
    )
  }
  // A chapter square in the Progress strip opens that chapter's dashboard, like its card.
  const openChapter = (scope: string) => {
    const ch = chapters.find((c) => contains(c, scope))
    router.push(chaptersHref(course.id, ch?.sectionKey ?? undefined))
  }

  return (
    <div className="flex flex-col gap-6">
      {data.isLive && (
        // Side by side on a laptop: less scrolling past empty width (v0.31.5).
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_auto]">
          <CourseStats data={data} home={home} onOpenSection={openChapter} />
          <StudyHeatmap doc={course.learnDocId} />
        </div>
      )}
      <ComprehensiveCard exams={exams} examChapters={examChapters} numbers={numbers} color={color} />
      <p className="-mb-3 text-meta text-muted-foreground">
        Exams are a preview: results come from the demo buttons and are saved in this browser only ·{" "}
        <button type="button" onClick={exams.reset} className="underline underline-offset-2 hover:text-foreground">
          reset
        </button>
      </p>
      {data.loading && chapters.length === 0 ? (
        <p className="text-muted-foreground">Loading chapters…</p>
      ) : (
        <div className="flex flex-col gap-7 pt-3">
          <div className="-mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
            {cg.groups.length > 0 && cg.isAuto && <span>Grouped by the book’s parts</span>}
            <button type="button" disabled={!cg.ready} onClick={() => setNaming({ mode: "new" })} className="hover:text-foreground disabled:opacity-50">
              + New chapter group
            </button>
            {!cg.isAuto && cg.hasBookParts && (
              <button type="button" onClick={cg.reset} className="hover:text-foreground">
                Reset to the book’s parts
              </button>
            )}
            {cg.saveError && (
              <span className="text-ink-danger">
                Groups not saved ·{" "}
                <button type="button" onClick={cg.retry} className="underline">
                  Retry
                </button>
              </span>
            )}
          </div>
          {sections.map((sec, si) => {
            const g = sec.group
            const isOpen = !g || !closed.has(g.id)
            const gi = g ? cg.groups.findIndex((x) => x.id === g.id) : -1
            const studied = sec.chapters.length
              ? Math.round(sec.chapters.reduce((a, c) => a + pct(by[c.sectionKey!]), 0) / sec.chapters.length)
              : 0
            return (
              <section key={g?.id ?? `loose-${si}`} className="flex flex-col gap-3">
                {g ? (
                  <GroupHeader
                    group={g}
                    count={sec.chapters.length}
                    studied={studied}
                    open={isOpen}
                    onToggle={() => setClosed((c) => toggleSet(c, g.id))}
                    editable={cg.ready}
                    first={gi === 0}
                    last={gi === cg.groups.length - 1}
                    onRename={() => setNaming({ mode: "rename", id: g.id, name: g.name })}
                    onMove={(dir) => cg.update((gs) => moveGroup(gs, g.id, dir))}
                    onDelete={() => cg.update((gs) => removeGroup(gs, g.id))}
                  />
                ) : (
                  cg.groups.length > 0 && (
                    <div className="border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {si === 0 ? "Before the first group" : "Not in a group"}
                    </div>
                  )
                )}
                {isOpen && sec.chapters.length === 0 && (
                  <p className="m-0 text-meta text-muted-foreground">
                    No chapters yet. Use a chapter’s ⋮ → Move to group.
                  </p>
                )}
                {isOpen && sec.chapters.length > 0 && (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-[18px]">
                    {sec.chapters.map((c) => renderCard(c, g?.id ?? null))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
      <GroupNameDialog
        open={naming !== null}
        title={naming?.mode === "rename" ? "Rename group" : "New chapter group"}
        initial={naming?.mode === "rename" ? naming.name : ""}
        onClose={() => setNaming(null)}
        onSave={(name) => {
          if (naming?.mode === "rename") cg.update((gs) => renameGroup(gs, naming.id, name))
          else cg.update((gs) => addGroup(gs, name, naming?.mode === "new" ? naming.chapterKey : undefined))
        }}
      />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">
        <Link href={`/courses/${course.id}/review`} className="hover:text-foreground">
          Review everything due{data.reviewDue ? ` (${data.reviewDue})` : ""}
        </Link>
        <Link href={`/courses/${course.id}/concepts`} className="hover:text-foreground">All concepts</Link>
        <Link href={`/courses/${course.id}/packs`} className="hover:text-foreground">Practice packs</Link>
        <Link href={`/courses/${course.id}/edit`} className="hover:text-foreground">Edit material</Link>
      </p>
    </div>
  )
}

function toggleSet(set: Set<string>, id: string): Set<string> {
  const n = new Set(set)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  return n
}
