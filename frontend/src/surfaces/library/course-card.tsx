"use client"

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
import { Sheet } from "@/kit/study"
import { chapterHref } from "@/kit/lib/scope-url"
import { coverMonogram } from "@/surfaces/library/cover"
import type { CourseGroup } from "@/surfaces/library/course-groups"
import type { Course, CourseStatus } from "@/surfaces/library/courses"

const STATUS_BADGE: Record<CourseStatus, { label: string; status: DomainStatus; pulse?: boolean }> = {
  ready: { label: "Ready", status: "ready" },
  converting: { label: "Converting", status: "building", pulse: true },
  empty: { label: "Not processed", status: "neutral" },
}

/** One course on the shelf. The title is a stretched link to the course home, so the whole
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
  return (
    <Sheet as="article" className="relative transition-colors hover:border-brand/50">
      <div className="flex items-start gap-3">
        {/* A monogram stands in for cover art: neutral, since colour is a signal here. */}
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-md bg-muted font-mono text-title font-semibold text-muted-foreground"
        >
          {coverMonogram(course.title)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-body font-semibold leading-snug">
            <Link href={`/courses/${course.id}`} className="after:absolute after:inset-0">
              {course.title}
            </Link>
          </h3>
          <p className="truncate text-meta text-muted-foreground">{course.description}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative z-10 -mr-2 -mt-1 h-7 w-7" aria-label="Course actions">
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

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={badge.status} pulse={badge.pulse}>
          {badge.label}
        </StatusPill>
        {dueNow > 0 && <StatusPill status="due">{dueNow} due</StatusPill>}
        {course.format && (
          <span className="text-micro font-medium uppercase tracking-label text-muted-foreground">{course.format}</span>
        )}
      </div>

      {/* Quick action: straight into reading without the course-home stop. */}
      {ready && (
        <Button asChild variant="secondary" size="sm" className="relative z-10 self-start">
          <Link href={chapterHref(course.id, continueKey)}>
            <BookOpen />
            {continueKey ? "Continue" : "Start reading"}
          </Link>
        </Button>
      )}
    </Sheet>
  )
}
