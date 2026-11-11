"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { BookOpen, MoreVertical, Plus, Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/kit/ui/dropdown-menu"
import { StatusPill, type DomainStatus } from "@/kit/patterns/status-pill"
import { chapterHref } from "@/kit/lib/scope-url"
import { coverColor, coverMonogram } from "@/surfaces/library/cover"
import { useCourseMastery } from "@/surfaces/library/use-library-queries"
import type { CourseGroup } from "@/surfaces/library/course-groups"
import type { Course, CourseStatus } from "@/surfaces/library/courses"

const STATUS_BADGE: Record<CourseStatus, { label: string; status: DomainStatus; pulse?: boolean }> = {
  ready: { label: "Ready", status: "ready" },
  converting: { label: "Converting", status: "building", pulse: true },
  empty: { label: "Not processed", status: "neutral" },
}

/** One course on the shelf, as a cover in its own colour (v0.31.0). The title is a stretched link to the course home, so the whole
 *  card opens it; the menu and the reading button sit above that link. */
export function CourseCard({
  course,
  dueNow,
  continueKey,
  groups,
  courseGroupIds,
  groupsReady,
  onToggleMembership,
  onNewGroupForCourse,
  onDelete,
}: {
  course: Course
  dueNow: number
  continueKey: string | null
  groups: CourseGroup[]
  courseGroupIds: string[]
  /** False until the saved groups load: membership edits wait for them. */
  groupsReady: boolean
  onToggleMembership: (courseId: string, groupId: string) => void
  onNewGroupForCourse: (courseId: string) => void
  onDelete: (course: Course) => void
}) {
  const badge = STATUS_BADGE[course.status]
  const ready = course.status === "ready"
  const color = coverColor(course.title)
  // Studied share loads only once the cover is on screen: 19 covers asking at once
  // exhausted the API's database pool and starved the due counts (found in verify, v0.31.0).
  const ref = useRef<HTMLElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  const mastery = useCourseMastery(ready && seen ? course.learnDocId : undefined)
  const overall = mastery.data?.overall
  const studied = overall && overall.total > 0 ? Math.round(overall.coverage * 100) : null
  return (
    <article ref={ref} className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/30">
      {/* The cover: the course's own colour, its initials and its title. */}
      <div
        className="flex h-48 flex-col justify-between gap-3 p-4"
        style={{ background: `linear-gradient(160deg, ${color}66, ${color}22 80%)`, borderBottom: `3px solid ${color}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <span aria-hidden className="select-none text-micro font-semibold tracking-label" style={{ color }}>
            {coverMonogram(course.title)}
          </span>
          <div className="flex items-center gap-2">
            {dueNow > 0 && (
              <span className="rounded-full bg-status-due px-2 py-px text-micro font-semibold tabular-nums text-background">
                {dueNow} due
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative z-10 -mr-2 -mt-2 h-7 w-7 text-foreground/80" aria-label="Course actions">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Move to group</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!groupsReady ? (
                  <DropdownMenuItem disabled>Groups are loading…</DropdownMenuItem>
                ) : groups.length === 0 ? (
                  <DropdownMenuItem disabled>No groups yet</DropdownMenuItem>
                ) : (
                  groups.map((g) => (
                    <DropdownMenuCheckboxItem
                      key={g.id}
                      checked={courseGroupIds.includes(g.id)}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={() => onToggleMembership(course.id, g.id)}
                    >
                      {g.name}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!groupsReady} onClick={() => onNewGroupForCourse(course.id)}>
                  <Plus className="h-4 w-4" />
                  New group…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-ink-danger focus:text-ink-danger" onClick={() => onDelete(course)}>
                  <Trash2 className="h-4 w-4" />
                  Delete course…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <h3 className="line-clamp-3 font-serif text-[1.375rem] font-semibold leading-tight">
          <Link href={`/courses/${course.id}`} className="after:absolute after:inset-0">
            {course.title}
          </Link>
        </h3>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="truncate text-meta text-muted-foreground">{course.description}</p>
        {ready ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-muted">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max(studied ?? 0, 1)}%`, background: color }} />
            </div>
            <span className="text-micro tabular-nums text-muted-foreground">
              {studied != null ? `${studied}% studied` : mastery.data ? "No concepts yet" : ""}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={badge.status} pulse={badge.pulse}>
              {badge.label}
            </StatusPill>
            {course.format && (
              <span className="text-micro font-medium uppercase tracking-label text-muted-foreground">{course.format}</span>
            )}
          </div>
        )}
        {/* Quick action: straight into reading without the course-home stop. */}
        {ready && (
          <Button asChild variant="outline" size="sm" className="relative z-10 mt-auto self-start">
            <Link href={chapterHref(course.id, continueKey)}>
              <BookOpen />
              {continueKey ? "Continue" : "Start reading"}
            </Link>
          </Button>
        )}
      </div>
    </article>
  )
}
