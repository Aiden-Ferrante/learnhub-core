"use client"

/** TRIAL (v0.31.4): the course Overview as chapter cards, from the "Overview D · Cards only"
 *  and "Chapter dashboard" boards on the LearnHub design canvas (2026-11-12).
 *
 *  - ChapterCards: Progress, then one card per top-level chapter (number, title, studied
 *    share, a red phone-app badge for what is due in it), then Study activity. The human
 *    asked for Progress and activity back on 2026-11-19 after trying the cards-only page.
 *  - ChapterDashboard: one chapter's own page — Read / Review / Practice, then its sections.
 *
 *  Due counts come from ONE whole-course review queue, bucketed by chapter through the tree,
 *  never one request per card (that exhausted the API's pool in v0.31.1). Lives on its own
 *  route beside the current Overview so the two can be compared. */

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
import { StudyHeatmap } from "@/surfaces/library/study-heatmap"
import type { CourseData } from "@/surfaces/library/use-course-data"
import { useCourseHome } from "@/surfaces/library/use-course-home"

const COURSE_LIMIT = 200

function contains(node: LearnTreeNode, key: string): boolean {
  return node.sectionKey === key || node.children.some((c) => contains(c, key))
}

function pct(m: SectionMemory | undefined): number {
  return m && m.total > 0 ? Math.round(m.coverage * 100) : 0
}

export function chaptersHref(courseId: string, chapterKey?: string): string {
  return `/courses/${courseId}/chapters${chapterKey ? `/${encodeURIComponent(chapterKey)}` : ""}`
}

/** Top-level chapters, and the number the outline shows for each (none for front matter). */
function useChapters(tree: LearnTreeNode[]) {
  return useMemo(() => {
    const numbers = numberSections(tree)
    return { chapters: tree.filter((n) => n.isSection && n.sectionKey), numbers }
  }, [tree])
}

/** Due cards per chapter key, from one whole-course queue. */
function useDueByChapter(docId: string | undefined, chapters: LearnTreeNode[]) {
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

function Badge({ count }: { count: number }) {
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

function Bar({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <div className={cn("h-1 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full" style={{ width: `${value}%`, background: color }} />
    </div>
  )
}

function TrialNote({ courseId }: { courseId: string }) {
  return (
    <p className="text-meta text-muted-foreground">
      Trial layout ·{" "}
      <Link href={`/courses/${courseId}`} className="underline underline-offset-2 hover:text-foreground">
        back to the current Overview
      </Link>
    </p>
  )
}

export function ChapterCards({ data }: { data: CourseData }) {
  const course = data.course!
  const color = coverColor(course.title)
  const { chapters, numbers } = useChapters(data.tree)
  const due = useDueByChapter(course.learnDocId, chapters)
  const by = data.mastery?.bySection ?? {}
  const home = useCourseHome(course, data)
  const router = useRouter()
  // A chapter square in the Progress strip opens that chapter's dashboard, like its card.
  const openChapter = (scope: string) => {
    const ch = chapters.find((c) => contains(c, scope))
    router.push(chaptersHref(course.id, ch?.sectionKey ?? undefined))
  }

  return (
    <div className="flex flex-col gap-6">
      <TrialNote courseId={course.id} />
      {data.isLive && <CourseStats data={data} home={home} onOpenSection={openChapter} />}
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
                  {displaySectionTitle(c.label, c.title)}
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className="text-meta tabular-nums text-muted-foreground">{share}% studied</span>
                  <Bar value={share} color={color} />
                </span>
              </Link>
            )
          })}
        </div>
      )}
      {data.isLive && <StudyHeatmap doc={course.learnDocId} />}
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
  const share = pct(m)
  const n = due.get(chapterKey) ?? 0
  const sections = chapter.children.filter((s) => s.isSection && s.sectionKey)
  const here = data.continueSectionKey && contains(chapter, data.continueSectionKey) ? data.continueNode : null
  const readTarget = here?.sectionKey ?? sections[0]?.sectionKey ?? chapterKey
  const readLabel = here
    ? `Continue at ${[numbers.get(here.id), displaySectionTitle(here.label, here.title)].filter(Boolean).join(" ")}`
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
          <TrialNote courseId={course.id} />
        </div>
        <div className="flex items-center gap-[18px]">
          {numbers.get(chapter.id) && (
            <span className="font-serif text-[56px] font-semibold leading-none" style={{ color }}>
              {numbers.get(chapter.id)}
            </span>
          )}
          <div>
            <h1 className="m-0 font-serif text-[32px] font-semibold leading-tight">
              {displaySectionTitle(chapter.label, chapter.title)}
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
        <div className="relative flex flex-col gap-1.5 rounded-[14px] border border-border bg-card p-[18px]">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Practice</span>
          <span className="flex-1 font-semibold">Exam packs for this course</span>
          <Link href={`/courses/${course.id}/packs`} className={action}>
            Start practice
          </Link>
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
                    {displaySectionTitle(s.label, s.title).replace(/^[\s–—-]+/, "")}
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
    </div>
  )
}
