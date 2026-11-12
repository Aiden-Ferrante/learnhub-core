"use client"

import { useState } from "react"
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
import type { SectionMemory } from "@/gateways/api/progress"
import type { CourseGroup } from "@/surfaces/library/course-groups"
import type { Course, CourseStatus } from "@/surfaces/library/courses"

const STATUS_BADGE: Record<CourseStatus, { label: string; status: DomainStatus; pulse?: boolean }> = {
  ready: { label: "Ready", status: "ready" },
  converting: { label: "Converting", status: "building", pulse: true },
  empty: { label: "Not processed", status: "neutral" },
}

/** One course on the shelf: a framed card with the book cover at about 70% of the card (v0.31.2). The title is a stretched link to the course home, so the whole
 *  card opens it; the menu and the reading button sit above that link. */
export function CourseCard({
  course,
  mastery,
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
  /** The course's whole-book summary; undefined while loading, null when it has none. */
  mastery: SectionMemory | null | undefined
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
  const studied = mastery && mastery.total > 0 ? Math.round(mastery.coverage * 100) : null
  const [coverFailed, setCoverFailed] = useState(false)
  const showCover = ready && !!course.learnDocId && !coverFailed
  return (
    <article className="group relative flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 transition-colors hover:border-foreground/30">
      {/* The cover: page 1 of the book's PDF, or (no PDF) a quiet tile in the course colour. */}
      <div className="relative mx-auto aspect-[3/4] w-[76%] overflow-hidden rounded-md border border-border bg-background shadow-sm">
        {showCover ? (
          // eslint-disable-next-line @next/next/no-img-element -- a same-origin proxy, sized by CSS
          <img
            src={`/api/learn/cover?doc=${encodeURIComponent(course.learnDocId as string)}`}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="flex h-full flex-col justify-between p-3" style={{ background: `${color}1f` }}>
            <span aria-hidden className="text-micro font-semibold tracking-label" style={{ color }}>
              {coverMonogram(course.title)}
            </span>
            <span aria-hidden className="line-clamp-4 font-serif text-[1.05rem] font-semibold leading-snug text-foreground/90">
              {course.title}
            </span>
          </div>
        )}
        {dueNow > 0 && (
          <span className="absolute right-2 top-2 rounded-full bg-status-due px-2 py-px text-micro font-semibold tabular-nums text-background shadow">
            {dueNow} due
          </span>
        )}
        {/* Studied share as the cover's bottom edge, in the course colour. */}
        {ready && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-background/70">
            <div className="h-1" style={{ width: `${studied ?? 0}%`, background: color }} />
          </div>
        )}
        {ready && (
          <Button
            asChild
            size="sm"
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 opacity-0 shadow transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Link href={chapterHref(course.id, continueKey)}>
              <BookOpen />
              {continueKey ? "Continue" : "Start"}
            </Link>
          </Button>
        )}
      </div>

      <div className="flex items-start gap-1">
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1 pl-1">
          <h3 className="line-clamp-2 text-meta font-medium leading-snug">
            <Link href={`/courses/${course.id}`} className="after:absolute after:inset-0">
              {course.title}
            </Link>
          </h3>
          {ready ? (
            <p className="text-micro tabular-nums text-muted-foreground">
              {studied != null ? `${studied}% studied` : mastery !== undefined ? "No concepts yet" : "\u00a0"}
            </p>
          ) : (
            <StatusPill status={badge.status} pulse={badge.pulse}>
              {badge.label}
            </StatusPill>
          )}
        </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative z-10 -mr-1.5 h-7 w-7 shrink-0 text-muted-foreground" aria-label="Course actions">
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
    </article>
  )
}
