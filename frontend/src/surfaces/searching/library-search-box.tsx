"use client"

/** Board 1 · "Library search — as you type": the Library's search box with the Meaning /
 *  Exact words switch and a dropdown of Concepts (with status and "in N books"), Passages
 *  and Courses. ↑↓ move, ↵ opens, Esc closes; the footer opens the full results page. The
 *  tag chips under the box still filter: the dropdown only looks inside tagged courses. */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { Search } from "lucide-react"
import { cn } from "@/kit/lib/utils"
import { chapterHref } from "@/kit/lib/scope-url"
import type { Course } from "@/surfaces/library/courses"
import { conceptGroupHref, flat, searchConcepts, searchHref, sectionLabel, terms, type ConceptGroup } from "@/surfaces/searching/search-model"
import { BookDot, Highlighted, Kbd, MatchBar, ModeSwitch, StatusPill } from "@/surfaces/searching/search-ui"
import { useDebounced, usePassages, useSearchCourses, useSearchIndex } from "@/surfaces/searching/use-library-search"

export const conceptHref = (g: ConceptGroup) =>
  g.items.length > 1 ? conceptGroupHref(g.name) : `/courses/${g.items[0].courseId}/concepts?concept=${encodeURIComponent(g.items[0].key)}`

export function LibrarySearchBox({
  query,
  onQuery,
  picked,
  matchingCourses,
}: {
  query: string
  onQuery: (q: string) => void
  /** Tags picked below the box; results stay inside courses that carry them. */
  picked: string[]
  /** Courses the shelf's own filter matches (title, description, tags). */
  matchingCourses: Course[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const q = useDebounced(query, 180)
  const ts = useMemo(() => terms(q), [q])
  const { byDoc } = useSearchCourses()
  const idx = useSearchIndex(touched)
  const passages = usePassages(q, null, 12)

  const allowed = useMemo(() => (picked.length ? new Set(matchingCourses.map((c) => c.learnDocId).filter(Boolean) as string[]) : null), [picked, matchingCourses])
  const groups = useMemo(() => searchConcepts(idx.index, q, { docIds: allowed }), [idx.index, q, allowed])
  const passageHits = (passages.data?.matches ?? []).filter((m) => byDoc.has(m.docId) && (!allowed || allowed.has(m.docId)))
  const courseHits = query.trim() ? matchingCourses.slice(0, 3) : []

  const rows = [
    ...groups.slice(0, 5).map((g) => conceptHref(g)),
    ...passageHits.slice(0, 3).map((m) => chapterHref(byDoc.get(m.docId)!.id, m.sectionKey)),
    ...courseHits.map((c) => `/courses/${c.id}`),
  ]
  const all = searchHref(query.trim(), picked.length ? { tags: picked.join(",") } : undefined)
  const total = groups.length + (passages.data?.total ?? 0) + matchingCourses.length
  const show = open && query.trim().length >= 2

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    const onDown = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  let n = -1
  const rowProps = () => {
    n++
    const i = n
    return { "data-active": i === active, onMouseEnter: () => setActive(i), className: cn("flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left", i === active && "bg-muted") }
  }
  const loading = idx.status === "loading" || (passages.status === "loading" && passages.data === undefined)

  return (
    <div ref={wrap} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            onQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setTouched(true)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") return setOpen(false)
            if (!show) return
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, rows.length))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === "Enter") {
              e.preventDefault()
              router.push(rows[active] ?? all)
            }
          }}
          placeholder="Search concepts, passages, courses and tags…"
          aria-label="Search the library"
          role="combobox"
          aria-expanded={show}
          aria-controls="library-search-results"
          className="h-11 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
        />
        <ModeSwitch className="hidden sm:flex" />
      </div>

      {show && (
        <div id="library-search-results" className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <div className="max-h-[min(70vh,34rem)] overflow-y-auto p-1.5">
            {loading && groups.length === 0 && <p className="px-3 py-3 text-meta text-muted-foreground">Looking through your books…</p>}

            {groups.length > 0 && (
              <Section label="Concepts" note="closest by words">
                {groups.slice(0, 5).map((g) => {
                  const c = g.items[0]
                  return (
                    <Link key={g.id} href={conceptHref(g)} {...rowProps()}>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <Highlighted text={g.name} terms={ts} className="truncate font-medium" />
                          <StatusPill status={c.status} />
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                          <BookDot title={c.courseTitle} />
                          <span className="truncate">
                            {c.courseTitle} · {sectionLabel(c.sectionKey)}
                          </span>
                          {g.items.length > 1 && <span className="shrink-0 font-medium text-brand">· in {g.items.length} books</span>}
                        </span>
                      </span>
                      <MatchBar share={g.share} className="mt-1 hidden sm:inline-flex" />
                    </Link>
                  )
                })}
              </Section>
            )}

            {passageHits.length > 0 && (
              <Section label="Passages">
                {passageHits.slice(0, 3).map((m) => {
                  const course = byDoc.get(m.docId)!
                  return (
                    <Link key={`${m.docId}${m.sectionKey}`} href={chapterHref(course.id, m.sectionKey)} {...rowProps()}>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-meta text-foreground/90">
                          <Highlighted text={flat(m.snippet)} terms={ts} />
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                          <BookDot title={course.title} />
                          <span className="truncate">
                            {course.title} · {m.heading ? flat(m.heading) : sectionLabel(m.sectionKey)}
                          </span>
                        </span>
                      </span>
                    </Link>
                  )
                })}
              </Section>
            )}

            {courseHits.length > 0 && (
              <Section label="Courses">
                {courseHits.map((c) => (
                  <Link key={c.id} href={`/courses/${c.id}`} {...rowProps()}>
                    <BookDot title={c.title} className="mt-1.5" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      <Highlighted text={c.title} terms={ts} />
                    </span>
                  </Link>
                ))}
              </Section>
            )}

            {!loading && groups.length === 0 && passageHits.length === 0 && courseHits.length === 0 && (
              <p className="px-3 py-3 text-meta text-muted-foreground">Nothing has those words. Fewer or different words may help.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-micro text-muted-foreground">
            <span className="hidden items-center gap-1 sm:flex">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move · <Kbd>↵</Kbd> open · <Kbd>esc</Kbd> close
            </span>
            {picked.length > 0 && <span>Only in courses tagged {picked.join(" + ")}</span>}
            <Link
              href={all}
              data-active={active === rows.length}
              onMouseEnter={() => setActive(rows.length)}
              className={cn("ml-auto rounded px-1.5 py-0.5 font-medium text-brand hover:underline", active === rows.length && "bg-muted")}
            >
              See all {total.toLocaleString()} results →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 pb-1 pt-1.5 text-micro uppercase tracking-label text-muted-foreground">
        {label}
        {note && <span className="ml-2 normal-case tracking-normal opacity-70">{note}</span>}
      </p>
      {children}
    </div>
  )
}
