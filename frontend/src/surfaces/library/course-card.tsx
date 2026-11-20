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
import { cn } from "@/kit/lib/utils"
import { coverColor, coverMonogram } from "@/surfaces/library/cover"
import type { SectionMemory } from "@/gateways/api/progress"
import type { CourseGroup } from "@/surfaces/library/course-groups"
import type { Course, CourseStatus } from "@/surfaces/library/courses"

const STATUS_BADGE: Record<CourseStatus, { label: string; status: DomainStatus; pulse?: boolean }> = {
  ready: { label: "Ready", status: "ready" },
  converting: { label: "Converting", status: "building", pulse: true },
  empty: { label: "Not processed", status: "neutral" },
}

/** The cover: page 1 of the book's PDF, or (no PDF) a tile in the course colour with the
 *  title set to fit. Fills its parent, which sets the size and frame. */
export function CourseCover({ course, small }: { course: Course; small?: boolean }) {
  const color = coverColor(course.title)
  const [failed, setFailed] = useState(false)
  if (course.status === "ready" && course.learnDocId && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a same-origin proxy, sized by CSS
      <img
        src={`/api/learn/cover?doc=${encodeURIComponent(course.learnDocId)}`}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover object-top"
      />
    )
  }
  return (
    <div
      className={cn("flex h-full flex-col justify-between", small ? "p-1.5" : "p-3")}
      style={{ background: `linear-gradient(160deg, ${color}66, ${color}22 75%)` }}
    >
      <span aria-hidden className="text-micro font-semibold tracking-label" style={{ color }}>
        {coverMonogram(course.title)}
      </span>
      {!small && (
        <span aria-hidden className="line-clamp-5 hyphens-auto font-serif text-[0.82rem] font-semibold leading-snug text-foreground/90" lang="en">
          {course.title}
        </span>
      )}
      <span aria-hidden className="h-0.5 w-8 rounded-full" style={{ background: color }} />
    </div>
  )
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
  onDragStart,
  onDragEnd,
  dragging,
  subtitle,
}: {
  course: Course
  /** A second line that tells apart two courses with the same title. */
  subtitle?: string
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
  /** Drag the card onto a group in the sidebar to put it there (v0.31.5). */
  onDragStart?: () => void
  onDragEnd?: () => void
  dragging?: boolean
}) {
  const badge = STATUS_BADGE[course.status]
  const ready = course.status === "ready"
  const color = coverColor(course.title)
  const studied = mastery && mastery.total > 0 ? Math.round(mastery.coverage * 100) : null
  return (
    <article
      draggable={Boolean(onDragStart)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copyMove"
        e.dataTransfer.setData("text/plain", course.title) // Firefox needs data to drag
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex cursor-grab flex-col gap-2.5 rounded-xl border border-border bg-card p-3 transition-[colors,opacity] hover:border-foreground/30 active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="relative mx-auto aspect-[3/4] w-[76%] overflow-hidden rounded-md border border-border bg-background shadow-sm">
        <CourseCover course={course} />
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
            <Link href={chapterHref(course.id, continueKey)} draggable={false}>
              <BookOpen />
              {continueKey ? "Continue" : "Start"}
            </Link>
          </Button>
        )}
      </div>

      <div className="flex items-start gap-1">
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1 pl-1">
          <h3 className="line-clamp-3 text-meta font-medium leading-snug" title={course.title}>
            <Link href={`/courses/${course.id}`} draggable={false} className="after:absolute after:inset-0">
              {course.title}
            </Link>
          </h3>
          {subtitle && <p className="line-clamp-2 text-micro text-muted-foreground" title={subtitle}>{subtitle}</p>}
          {ready ? (
            <p className="text-micro tabular-nums text-muted-foreground">
              {studied ? `${studied}% studied` : mastery !== undefined ? "Not started" : "\u00a0"}
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
