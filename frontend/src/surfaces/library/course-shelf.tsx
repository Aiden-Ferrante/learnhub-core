"use client"

/** The Library (docs/ui-spec.md §3; Bookshelf since v0.31.0): programs on top, then the search with
 *  its tags, In progress, and the course grid. Course groups and their sidebar were retired on
 *  2026-11-21 for tags ("shift over to having a tagging system on the search"). Admin entry
 *  points (Upload, Process) sit in the header, quietly. */

import { useMemo, useState } from "react"
import Link from "next/link"
import { GraduationCap, Plus, Zap } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { cn } from "@/kit/lib/utils"
import { EmptyState } from "@/kit/patterns/empty-state"
import { PageHeader } from "@/kit/patterns/page-header"
import { ErrorNotice } from "@/kit/data"
import { Sheet } from "@/kit/study"
import { CourseCard } from "@/surfaces/library/course-card"
import { allTags, matches, sameTag, setCourseTags } from "@/surfaces/library/course-tags"
import { courseFromDocument, type Course } from "@/surfaces/library/courses"
import { DeleteCourseDialog } from "@/surfaces/library/delete-course-dialog"
import { InProgress, useInProgress } from "@/surfaces/library/in-progress"
import { TagsDialog } from "@/surfaces/library/tags-dialog"
import { UnlistedBooks } from "@/surfaces/library/unlisted-books"
import { useCourseTags } from "@/surfaces/library/use-course-tags"
import { useReadingPositions, useShelfMastery, useStudyDebt } from "@/surfaces/library/use-library-queries"
import { useDocuments } from "@/surfaces/processing"
import { ProgramBanners } from "@/surfaces/programs/program-banners"
import { LibrarySearchBox } from "@/surfaces/searching"

function FirstCourse() {
  return (
    <EmptyState
      icon={<GraduationCap />}
      title="Start your first course"
      description="Drop in a PDF and Learn Hub turns it into concepts you can study: read it, recall it, and track what you've mastered. Upload → Process → Study."
      action={
        <Button asChild>
          <Link href="/upload">
            <Plus />
            Upload a document
          </Link>
        </Button>
      }
      className="min-h-[420px]"
    />
  )
}

export function CourseShelf() {
  const { documents } = useDocuments()
  const courses = useMemo(() => documents.map(courseFromDocument), [documents])

  // Per-course due counts and saved reading positions: one cached read each, shared by
  // every card (and by the Today panel and the course home).
  const debt = useStudyDebt()
  const positions = useReadingPositions()
  const dueByDoc = useMemo(
    () => new Map((debt.data?.courses ?? []).map((c) => [c.doc, c.dueNow])),
    [debt.data],
  )

  // Studied share for every cover, in one read (19 per-card reads exhausted the API pool).
  const shelfMastery = useShelfMastery(
    useMemo(() => courses.filter((c) => c.status === "ready" && c.learnDocId).map((c) => c.learnDocId as string), [courses]),
  )

  const tags = useCourseTags()
  const [picked, setPicked] = useState<string[]>([])
  const [tagging, setTagging] = useState<Course | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null)
  const [query, setQuery] = useState("")

  const known = useMemo(() => allTags(tags.map, new Set(courses.map((c) => c.id))), [tags.map, courses])
  const toggleTag = (t: string) =>
    setPicked((p) => (p.some((x) => sameTag(x, t)) ? p.filter((x) => !sameTag(x, t)) : [...p, t]))
  const filtering = picked.length > 0 || query.trim().length > 0
  const visibleCourses = useMemo(
    () => courses.filter((c) => matches(c, tags.map, picked, query)),
    [courses, tags.map, picked, query],
  )

  // "In progress" first (2026-11-19 layout trial): only with no search or tag, and those
  // courses then leave the grid below so nothing shows twice.
  const studiedOf = (c: Course) => {
    const m = c.learnDocId ? shelfMastery.data?.overall[c.learnDocId] : undefined
    return m && m.total > 0 ? Math.round(m.coverage * 100) : 0
  }
  const dueOf = (c: Course) => (c.learnDocId ? (dueByDoc.get(c.learnDocId) ?? 0) : 0)
  const inProgress = useInProgress(courses, studiedOf, dueOf)
  const showInProgress = !filtering
  const inProgressIds = new Set(inProgress.items.map((i) => i.course.id))
  const gridCourses = showInProgress ? visibleCourses.filter((c) => !inProgressIds.has(c.id)) : visibleCourses
  // Two courses with one title get their description as a second line.
  const titleCount = new Map<string, number>()
  for (const c of courses) titleCount.set(c.title.toLowerCase(), (titleCount.get(c.title.toLowerCase()) ?? 0) + 1)
  const subtitleOf = (c: Course) => ((titleCount.get(c.title.toLowerCase()) ?? 0) > 1 ? c.description : undefined)

  return (
    <>
      <PageHeader
        title="Library"
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/upload">
                <Plus />
                Upload
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/process">
                <Zap />
                Process
              </Link>
            </Button>
          </>
        }
      />

      {courses.length > 0 && <ProgramBanners />}
      {courses.length === 0 ? (
        <FirstCourse />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <LibrarySearchBox query={query} onQuery={setQuery} picked={picked} matchingCourses={visibleCourses} />
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter by tag">
              {known.length === 0 ? (
                <span className="text-meta text-muted-foreground">
                  No tags yet. Use a course’s ⋮ menu → Tags… to add some, then filter by them here.
                </span>
              ) : (
                <>
                  {known.map(({ tag, count }) => {
                    const on = picked.some((p) => sameTag(p, tag))
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleTag(tag)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-meta transition-colors",
                          on ? "border-brand/60 bg-brand/15 text-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                        )}
                      >
                        {tag} <span className="tabular-nums opacity-60">{count}</span>
                      </button>
                    )
                  })}
                  {filtering && (
                    <button
                      type="button"
                      onClick={() => {
                        setPicked([])
                        setQuery("")
                      }}
                      className="ml-1 text-meta font-medium text-brand hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </>
              )}
            </div>
            {tags.saveError && <ErrorNotice compact title="Tags not saved" error={tags.saveError} onRetry={tags.retry} />}
          </div>
          {showInProgress && <InProgress {...inProgress} />}
          {visibleCourses.length === 0 && filtering && (
            <p className="text-body text-muted-foreground">
              No courses match{query.trim() ? ` “${query.trim()}”` : ""}
              {picked.length ? ` with ${picked.join(" + ")}` : ""}.
            </p>
          )}
          {(showInProgress && inProgress.items.length > 0) || filtering ? (
            <h2 className="-mb-1 mt-2 text-micro uppercase tracking-label text-muted-foreground">
              {filtering ? "Matching" : "On the shelf"} · {gridCourses.length}
            </h2>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-5 gap-y-6">
            {gridCourses.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                subtitle={subtitleOf(course)}
                mastery={course.learnDocId && shelfMastery.data ? (shelfMastery.data.overall[course.learnDocId] ?? null) : undefined}
                dueNow={course.learnDocId ? (dueByDoc.get(course.learnDocId) ?? 0) : 0}
                continueKey={positions.data?.[course.id] ?? null}
                tags={tags.map[course.id] ?? []}
                activeTags={picked}
                onTagClick={toggleTag}
                onEditTags={(c) => tags.ready && setTagging(c)}
                onDelete={setDeleteTarget}
              />
            ))}
            {!filtering && (
              <Link href="/upload" className="group block rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Sheet as="div" className="aspect-[3/4] items-center justify-center border-dashed text-muted-foreground transition-colors group-hover:border-brand/50 group-hover:text-foreground">
                  <Plus className="h-6 w-6" />
                  <span className="text-body font-medium">New course</span>
                  <span className="text-meta">Upload &amp; process a document</span>
                </Sheet>
              </Link>
            )}
          </div>
        </div>
      )}

      {!filtering && <UnlistedBooks courses={courses} onDelete={setDeleteTarget} />}

      <TagsDialog
        course={tagging}
        tags={tagging ? (tags.map[tagging.id] ?? []) : []}
        known={known.map((k) => k.tag)}
        onClose={() => setTagging(null)}
        onSave={(next) => {
          if (tagging) tags.update((m) => setCourseTags(m, tagging.id, next))
          setTagging(null)
        }}
      />
      <DeleteCourseDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </>
  )
}
