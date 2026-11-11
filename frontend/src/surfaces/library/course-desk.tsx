"use client"

/** The Desk (v0.30.0): one workspace per course. Every course route renders inside it, so
 *  moving between reading, review, packs and concepts keeps the same frame: a mode bar on top
 *  and the book's chapters down the left with how much of each you have studied. The page
 *  itself (course home, reader, review, packs, concepts) stays what it was. */

import Link from "next/link"
import { usePathname } from "next/navigation"
import type React from "react"
import type { LearnTreeNode } from "@/gateways/api/outline"
import type { SectionMemory } from "@/gateways/api/progress"
import { chapterHref, scopeFromSegments } from "@/kit/lib/scope-url"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { cn } from "@/kit/lib/utils"
import { coverColor } from "@/surfaces/library/cover"
import { useCourseData } from "@/surfaces/library/use-course-data"

type Mode = "overview" | "read" | "review" | "packs" | "concepts" | null

function modeOf(path: string, base: string): Mode {
  const rest = path.slice(base.length)
  if (rest === "" || rest === "/") return "overview"
  if (rest.startsWith("/chapter") || rest.startsWith("/read")) return "read"
  if (rest.startsWith("/review")) return "review"
  if (rest.startsWith("/packs")) return "packs"
  if (rest.startsWith("/concepts")) return "concepts"
  return null
}

/** The section key the reader is on, read off the address bar (the reader keeps it there). */
function scopeOf(path: string, base: string): string | null {
  const rest = path.slice(base.length)
  if (!rest.startsWith("/chapter/")) return null
  return scopeFromSegments(rest.slice("/chapter/".length).split("/").map(decodeURIComponent))
}

function contains(node: LearnTreeNode, key: string): boolean {
  return node.sectionKey === key || node.children.some((c) => contains(c, key))
}

/** Studied share as a whole percent: how many of the chapter's concepts you have reviewed. */
function pct(m: SectionMemory | undefined): number | null {
  return m && m.total > 0 ? Math.round(m.coverage * 100) : null
}

const STATE_DOT: Record<string, string> = {
  solid: "bg-status-mastered",
  shaky: "bg-status-due",
  fading: "bg-status-fading",
  new: "border border-muted-foreground/60",
}

export function CourseDesk({ courseId, children }: { courseId: string; children: React.ReactNode }) {
  const path = usePathname() ?? ""
  const data = useCourseData(courseId)
  if (!data.course) return <>{children}</>

  const base = `/courses/${courseId}`
  const mode = modeOf(path, base)
  const scope = scopeOf(path, base)
  const chapters = data.tree.filter((n) => n.sectionKey)
  const current = scope ? chapters.find((c) => contains(c, scope)) : undefined
  const by = data.mastery?.bySection ?? {}
  const overall = pct(data.mastery?.overall)
  const title = cleanCourseTitle(data.course.title).title

  const modes: { key: Exclude<Mode, null>; label: string; href: string; badge?: number }[] = [
    { key: "overview", label: "Overview", href: base },
    { key: "read", label: "Read", href: chapterHref(courseId, data.continueSectionKey ?? null) },
    { key: "review", label: "Review", href: `${base}/review`, badge: data.reviewDue || undefined },
    { key: "packs", label: "Packs", href: `${base}/packs` },
    { key: "concepts", label: "Concepts", href: `${base}/concepts` },
  ]

  return (
    <div className="desk">
      <div className="border-b border-border bg-card/60">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5">
          <Link href={base} className="flex min-w-0 max-w-[28rem] items-center gap-2.5 font-serif text-section font-semibold text-foreground">
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: coverColor(title) }} />
            <span className="truncate">{title}</span>
          </Link>
          <nav aria-label="Course" className="flex flex-wrap gap-1 rounded-full border border-border bg-background p-1">
            {modes.map((m) => (
              <Link
                key={m.key}
                href={m.href}
                aria-current={mode === m.key ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-1.5 rounded-full px-4 text-meta font-medium transition-colors",
                  mode === m.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {m.label}
                {m.badge != null && (
                  <span className={cn("text-micro tabular-nums", mode === m.key ? "" : "text-ink-warn")}>{m.badge}</span>
                )}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="flex">
        <nav
          aria-label="Chapters"
          className="sticky top-[var(--fleet-header-h)] hidden h-[calc(100vh_-_var(--fleet-header-h))] w-64 shrink-0 overflow-y-auto border-r border-border bg-card/40 py-4 lg:block"
        >
          <div className="flex items-baseline justify-between px-5 pb-2 text-micro uppercase tracking-label text-muted-foreground">
            <span>Chapters</span>
            {overall != null && <span className="normal-case tracking-normal">{overall}% studied</span>}
          </div>
          {data.loading && chapters.length === 0 ? (
            <p className="px-5 text-meta text-muted-foreground">Loading the book…</p>
          ) : (
            <ol className="flex flex-col">
              {chapters.map((c, i) => {
                const m = by[c.sectionKey as string]
                const p = pct(m)
                const here = current?.id === c.id
                return (
                  <li key={c.id}>
                    <Link
                      href={chapterHref(courseId, c.sectionKey)}
                      aria-current={here ? "location" : undefined}
                      title={m ? `${m.reviewed} of ${m.total} concepts studied` : undefined}
                      className={cn(
                        "grid grid-cols-[14px_1fr_auto] items-center gap-2.5 px-5 py-2 text-meta transition-colors",
                        here ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("h-2.5 w-2.5 rounded-full", here ? "bg-primary" : STATE_DOT[m?.state ?? "new"])}
                      />
                      <span className="min-w-0 truncate">
                        <span className="tabular-nums">{c.label || i + 1}</span> {c.title}
                      </span>
                      <span className="text-micro tabular-nums">{p != null ? `${p}%` : ""}</span>
                    </Link>
                  </li>
                )
              })}
            </ol>
          )}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
