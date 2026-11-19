"use client"

/** The course page as chapter hubs (v0.31.4), from the "Overview D · Cards only" and
 *  "Chapter dashboard" boards on the LearnHub design canvas (2026-11-12), refined with the
 *  human on 2026-11-19. Replaced the tabbed Overview / Read / Review / Packs / Concepts.
 *
 *  - ChapterCards: Progress, Study activity, the comprehensive exam, then one card per top-level chapter (number,
 *    title, studied share, a red phone-app badge for what is due in it). The human
 *    asked for Progress and activity back on 2026-11-19 after trying the cards-only page.
 *  - ChapterDashboard: one chapter's hub — Read / Review / Chapter exam, its sections, its
 *    concepts. Exam results are a browser-only design demo (demo-exams.ts) until v0.32.0.
 *
 *  Due counts come from ONE whole-course review queue, bucketed by chapter through the tree,
 *  never one request per card (that exhausted the API's pool in v0.31.1). */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo } from "react"
import { displaySectionTitle, numberSections, type LearnTreeNode } from "@/gateways/api/outline"
import type { SectionMemory } from "@/gateways/api/progress"
import { fetchCourseReviewQueue } from "@/gateways/api/review"
import { qk, useApi } from "@/kit/data"
import { chapterHref } from "@/kit/lib/scope-url"
import { cn } from "@/kit/lib/utils"
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
  // A chapter square in the Progress strip opens that chapter's dashboard, like its card.
  const openChapter = (scope: string) => {
    const ch = chapters.find((c) => contains(c, scope))
    router.push(chaptersHref(course.id, ch?.sectionKey ?? undefined))
  }

  return (
    <div className="flex flex-col gap-6">
      {data.isLive && <CourseStats data={data} home={home} onOpenSection={openChapter} />}
      {data.isLive && <StudyHeatmap doc={course.learnDocId} />}
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-[18px] pt-3">
          {chapters.map((c) => {
            const num = numbers.get(c.id)
            const share = pct(by[c.sectionKey!])
            const n = due.get(c.sectionKey!) ?? 0
            return (
              <Link
                key={c.id}
                href={chaptersHref(course.id, c.sectionKey!)}
                className="relative flex min-h-[180px] flex-col gap-3 rounded-2xl border border-border bg-card p-[18px] transition hover:-translate-y-0.5 hover:border-muted-foreground/50"
              >
                <Badge count={n} />
                <span
                  className={cn("font-serif text-[44px] font-semibold leading-none", !(n > 0 || share > 0) && "text-muted-foreground/50")}
                  style={n > 0 || share > 0 ? { color } : undefined}
                >
                  {num ?? "·"}
                </span>
                <span className="flex-1 text-[15px] font-semibold leading-snug">
                  {plainTitle(c)}
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className="text-meta tabular-nums text-muted-foreground">{share}% studied</span>
                  <Bar value={share} color={color} />
                  {num ? <ExamLine rec={exams.chapters[c.sectionKey!]} /> : <span className="text-meta text-muted-foreground/60">No exam</span>}
                </span>
              </Link>
            )
          })}
        </div>
      )}
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

export function ChapterDashboard({ data, chapterKey }: { data: CourseData; chapterKey: string }) {
  const course = data.course!
  const color = coverColor(course.title)
  const { chapters, numbers } = useChapters(data.tree)
  const due = useDueByChapter(course.learnDocId, chapters)
  const chapter = chapters.find((c) => c.sectionKey === chapterKey)
  const by = data.mastery?.bySection ?? {}
  const exams = useDemoExams(course.id)

  if (!chapter) {
    return (
      <div className="flex flex-col gap-3">
        <Link href={chaptersHref(course.id)} className="text-meta text-muted-foreground hover:text-foreground">
          ← All chapters
        </Link>
        <p className="text-muted-foreground">{data.loading ? "Loading…" : "This chapter is not in the outline."}</p>
      </div>
    )
  }

  const m = by[chapterKey]
  const hasExam = Boolean(numbers.get(chapter.id))
  const rec = exams.chapters[chapterKey]
  const concepts: { key?: string | null; name: string; kind?: string | null }[] = []
  const gather = (node: LearnTreeNode) => {
    concepts.push(...(node.concepts ?? []))
    node.children.forEach(gather)
  }
  gather(chapter)
  const share = pct(m)
  const n = due.get(chapterKey) ?? 0
  const sections = chapter.children.filter((s) => s.isSection && s.sectionKey)
  const here = data.continueSectionKey && contains(chapter, data.continueSectionKey) ? data.continueNode : null
  const readTarget = here?.sectionKey ?? sections[0]?.sectionKey ?? chapterKey
  const readLabel = here?.sectionKey === chapterKey
    ? "Pick up where you left off"
    : here
    ? `Continue at ${[numbers.get(here.id), plainTitle(here)].filter(Boolean).join(" ")}`
    : "Start this chapter"
  const nextSection = sections.find((s) => contains(s, readTarget))

  const action =
    "mt-2 self-start rounded-lg border border-border px-3.5 py-2 text-meta font-semibold hover:border-muted-foreground/50"

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-4">
          <Link href={chaptersHref(course.id)} className="text-meta text-muted-foreground hover:text-foreground">
            ← All chapters
          </Link>
          <Link
            href={`/courses/${course.id}/chapters/${encodeURIComponent(chapterKey)}/path`}
            className="text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Try the path layout
          </Link>
        </div>
        <div className="flex items-center gap-[18px]">
          {numbers.get(chapter.id) && (
            <span className="font-serif text-[56px] font-semibold leading-none" style={{ color }}>
              {numbers.get(chapter.id)}
            </span>
          )}
          <div>
            <h1 className="m-0 font-serif text-[32px] font-semibold leading-tight">
              {plainTitle(chapter)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {share}% studied
              {m && m.total > 0 ? ` · ${m.reviewed} of ${m.total} concepts` : ""}
              {m?.state ? ` · ${m.state}` : ""}
            </p>
          </div>
        </div>
        <Bar value={share} color={color} className="mt-1.5 h-[5px] max-w-[420px]" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="relative flex flex-col gap-1.5 rounded-[14px] border border-border bg-card p-[18px]">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Read</span>
          <span className="flex-1 font-semibold">{readLabel}</span>
          <Link
            href={chapterHref(course.id, readTarget)}
            onClick={() => data.persistReadingPosition(readTarget)}
            className="mt-2 self-start rounded-lg bg-primary px-3.5 py-2 text-meta font-semibold text-primary-foreground"
          >
            {here ? "Continue reading" : "Start reading"}
          </Link>
        </div>
        <div className="relative flex flex-col gap-1.5 rounded-[14px] border border-border bg-card p-[18px]">
          <Badge count={n} />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Review</span>
          <span className="flex-1 font-semibold">
            {n > 0 ? `${n} card${n === 1 ? "" : "s"} due` : "Nothing due in this chapter"}
          </span>
          <Link href={chapterHref(course.id, chapterKey, { drawer: "review" })} className={action}>
            {n > 0 ? "Review now" : "Open review"}
          </Link>
        </div>
        <div
          className="relative flex flex-col gap-1.5 rounded-[14px] border bg-card p-[18px]"
          style={{ borderColor: rec?.passed ? "hsl(var(--status-mastered))" : undefined }}
        >
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Chapter exam</span>
          {hasExam ? (
            <>
              <span className="flex-1 font-semibold">
                {rec?.passed
                  ? `Passed · best ${rec.best}%`
                  : rec
                    ? `Last try ${rec.last}% · needs ${PASS_MARK}%`
                    : `Pass ${PASS_MARK}% to complete this chapter`}
              </span>
              <span className="text-meta text-muted-foreground">
                {rec ? `${rec.attempts} attempt${rec.attempts === 1 ? "" : "s"} · ` : ""}every retake has new questions
              </span>
              <button
                type="button"
                className={cn(
                  "mt-2 self-start rounded-lg px-3.5 py-2 text-meta font-semibold",
                  rec?.passed ? "border border-border" : "bg-primary text-primary-foreground",
                )}
              >
                {rec?.passed ? "Retake for practice" : rec ? "Retake exam" : "Take chapter exam"}
              </button>
              <DemoControls label="result" onScore={(score) => exams.sitChapter(chapterKey, score)} />
            </>
          ) : (
            <span className="flex-1 font-semibold text-muted-foreground">No exam for this part of the book</span>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-1.5 font-serif text-[22px] font-semibold">Sections</h2>
        {sections.length === 0 ? (
          <p className="text-muted-foreground">This chapter has no sections.</p>
        ) : (
          <div>
            {sections.map((s) => {
              const sm = by[s.sectionKey!]
              const sp = sm && sm.total > 0 ? pct(sm) : null
              return (
                <Link
                  key={s.id}
                  href={chapterHref(course.id, s.sectionKey!)}
                  onClick={() => data.persistReadingPosition(s.sectionKey!)}
                  className="flex items-center gap-4 rounded-md border-t border-border/60 px-3.5 py-3 hover:bg-muted/40"
                >
                  <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{numbers.get(s.id) ?? ""}</span>
                  <span className="min-w-0 flex-1">
                    {plainTitle(s)}
                    {s === nextSection && (
                      <span className="ml-2.5 text-[11px] font-semibold tracking-wider text-primary">NEXT</span>
                    )}
                  </span>
                  <span className="hidden w-36 sm:block">{sp != null && <Bar value={sp} color={color} />}</span>
                  <span className="w-11 text-right text-meta tabular-nums text-muted-foreground">
                    {sp != null ? `${sp}%` : ""}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <details>
          <summary className="flex cursor-pointer list-none items-baseline gap-3">
            <h2 className="m-0 font-serif text-[22px] font-semibold">Concepts</h2>
            <span className="text-meta text-muted-foreground">{concepts.length} in this chapter · show</span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {concepts.map((c, i) => (
              <Link
                key={`${c.key ?? c.name}-${i}`}
                href={`/courses/${course.id}/concepts${c.key ? `?concept=${encodeURIComponent(c.key)}` : ""}`}
                className="rounded-full border border-border px-3 py-1 text-meta hover:border-muted-foreground/50"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </details>
      </section>
    </div>
  )
}
