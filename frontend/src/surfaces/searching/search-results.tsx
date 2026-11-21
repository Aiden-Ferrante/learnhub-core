"use client"

/** Board 2 · "Results": /search?q=… — a filter rail (what to show, tags, program, my
 *  progress) and three bands: the best-matching idea (its definition, the books that explain
 *  it, "Review these N concepts"), related ideas grouped across books, and passages with the
 *  matching words marked. Filters live in the URL, so Back and links keep them. */

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { BookOpen, Layers, Search } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { cn } from "@/kit/lib/utils"
import { chapterHref } from "@/kit/lib/scope-url"
import { EmptyState } from "@/kit/patterns/empty-state"
import { ConceptMarkdown } from "@/surfaces/concepts"
import { allTags, matches, sameTag } from "@/surfaces/library/course-tags"
import { useCourseTags } from "@/surfaces/library/use-course-tags"
import { usePrograms } from "@/surfaces/programs"
import { conceptHref } from "@/surfaces/searching/library-search-box"
import {
  conceptGroupHref,
  flat,
  PROGRESS_BUCKET,
  reviewHref,
  searchConcepts,
  sectionLabel,
  terms,
  type ConceptGroup,
  type MemoryStatus,
  type ProgressFilter,
} from "@/surfaces/searching/search-model"
import { BookDot, Highlighted, MatchBar, ModeSwitch, StatusPill } from "@/surfaces/searching/search-ui"
import { usePassages, useSearchCourses, useSearchIndex } from "@/surfaces/searching/use-library-search"

type Kind = "concepts" | "passages" | "courses"
const KINDS: { id: Kind; label: string }[] = [
  { id: "concepts", label: "Concepts" },
  { id: "passages", label: "Passages" },
  { id: "courses", label: "Courses" },
]
const PROGRESS: { id: ProgressFilter; label: string }[] = [
  { id: "due", label: "Due for review" },
  { id: "new", label: "Not learned yet" },
  { id: "learned", label: "Learned" },
]

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : [])

export function SearchResults() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const q = params.get("q") ?? ""
  const kinds = new Set((list(params.get("kinds")) as Kind[]).length ? (list(params.get("kinds")) as Kind[]) : KINDS.map((k) => k.id))
  const picked = list(params.get("tags"))
  const programId = params.get("program") ?? ""
  const progress = new Set(list(params.get("progress")) as ProgressFilter[])

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    router.replace(`${pathname}?${p}`)
  }
  const toggle = (key: string, current: string[], v: string, all?: string[]) => {
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v]
    set({ [key]: all && next.length === all.length ? null : next.join(",") || null })
  }

  const [text, setText] = useState(q)
  useEffect(() => setText(q), [q])

  const { ready, byDoc } = useSearchCourses()
  const tags = useCourseTags()
  const programs = usePrograms()
  const idx = useSearchIndex()
  const passages = usePassages(q, null, 30)
  const ts = useMemo(() => terms(q), [q])

  const known = useMemo(() => allTags(tags.map, new Set(ready.map((c) => c.id))), [tags.map, ready])
  const program = programs.state.programs.find((p) => p.id === programId)
  const inProgram = program ? new Set(program.tracks.flatMap((t) => t.courseIds)) : null
  const scoped = ready.filter((c) => matches(c, tags.map, picked, "") && (!inProgram || inProgram.has(c.id)))
  const filtered = picked.length > 0 || inProgram !== null
  const docKey = filtered ? scoped.map((c) => c.learnDocId as string).sort().join(",") : null
  const statusKey = (Object.keys(PROGRESS_BUCKET) as MemoryStatus[]).filter((s) => progress.has(PROGRESS_BUCKET[s])).join(",")
  const docIds = useMemo(() => (docKey === null ? null : new Set(docKey.split(","))), [docKey])
  const groups = useMemo(
    () => searchConcepts(idx.index, q, { docIds, statuses: statusKey ? new Set(statusKey.split(",") as MemoryStatus[]) : null }),
    [idx.index, q, docIds, statusKey],
  )
  const passageHits = (passages.data?.matches ?? []).filter((m) => byDoc.has(m.docId) && (!docIds || docIds.has(m.docId)))
  const courseHits = q.trim() ? scoped.filter((c) => matches(c, tags.map, [], q)) : []
  const best = kinds.has("concepts") ? groups[0] : undefined
  const related = kinds.has("concepts") ? groups.slice(1, 13) : []
  const forReview = [...(best?.items ?? []), ...related.flatMap((g) => g.items)].slice(0, 20)

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring"
        onSubmit={(e) => {
          e.preventDefault()
          set({ q: text.trim() || null })
        }}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search the library"
          placeholder="Search concepts, passages and courses…"
          className="h-11 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
        />
        <ModeSwitch className="hidden sm:flex" />
      </form>

      <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5 text-meta lg:sticky lg:top-20">
          <Rail label="Show">
            {KINDS.map((k) => (
              <Check key={k.id} on={kinds.has(k.id)} onClick={() => toggle("kinds", Array.from(kinds), k.id, KINDS.map((x) => x.id))}>
                {k.label}
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {k.id === "concepts" ? groups.length : k.id === "passages" ? passageHits.length : courseHits.length}
                </span>
              </Check>
            ))}
          </Rail>
          {known.length > 0 && (
            <Rail label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {known.map(({ tag }) => {
                  const on = picked.some((p) => sameTag(p, tag))
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ tags: (on ? picked.filter((p) => !sameTag(p, tag)) : [...picked, tag]).join(",") || null })}
                      className={cn("rounded-full border px-2.5 py-0.5 transition-colors", on ? "border-brand/60 bg-brand/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </Rail>
          )}
          {programs.state.programs.length > 0 && (
            <Rail label="In program">
              <Check on={!programId} radio onClick={() => set({ program: null })}>
                Any
              </Check>
              {programs.state.programs.map((p) => (
                <Check key={p.id} on={p.id === programId} radio onClick={() => set({ program: p.id })}>
                  <span className="truncate">{p.name}</span>
                </Check>
              ))}
            </Rail>
          )}
          <Rail label="My progress">
            {PROGRESS.map((p) => (
              <Check key={p.id} on={progress.has(p.id)} onClick={() => toggle("progress", Array.from(progress), p.id)}>
                {p.label}
              </Check>
            ))}
          </Rail>
        </aside>

        <main className="flex min-w-0 flex-col gap-8">
          {!q.trim() ? (
            <EmptyState icon={<Search />} title="Search your library" description="Type a few words: a concept, a question, a phrase from a book." />
          ) : (
            <>
              <p className="text-meta text-muted-foreground">
                {idx.status === "loading" ? "Looking through your books…" : `${groups.length} ideas · ${passages.data?.total ?? 0} passages · ${courseHits.length} courses for “${q}”`}
                <span className="ml-2 opacity-70">matched by your words; meaning search is coming</span>
              </p>

              {best && <BestMatch group={best} ts={ts} reviewItems={forReview} q={q} />}

              {related.length > 0 && (
                <Band label="Related ideas" note="grouped when several books name the same idea">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {related.map((g) => (
                      <IdeaCard key={g.id} group={g} ts={ts} />
                    ))}
                  </div>
                </Band>
              )}

              {kinds.has("passages") && passageHits.length > 0 && (
                <Band label="Passages" note={`${passageHits.length} of ${passages.data?.total ?? passageHits.length}`}>
                  <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                    {passageHits.map((m) => {
                      const c = byDoc.get(m.docId)!
                      const at = sectionLabel(m.sectionKey)
                      return (
                        <li key={`${m.docId}${m.sectionKey}`} className="flex flex-col gap-1.5 px-5 py-4">
                          <p className="flex flex-wrap items-center gap-x-2 text-micro text-muted-foreground">
                            <BookDot title={c.title} />
                            <span className="truncate">{c.title}</span>
                            {m.pageStart != null && <span>· p. {m.pageStart}</span>}
                            <span>· {m.termsMatched} words</span>
                          </p>
                          <p className="font-medium leading-snug">{m.heading ? flat(m.heading) : at}</p>
                          <p className="line-clamp-3 text-meta text-foreground/80">
                            <Highlighted text={flat(m.snippet)} terms={ts} />
                          </p>
                          <Link href={chapterHref(c.id, m.sectionKey)} className="self-start text-meta font-medium text-brand hover:underline">
                            Open at {at} →
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </Band>
              )}

              {kinds.has("courses") && courseHits.length > 0 && (
                <Band label="Courses">
                  <ul className="flex flex-wrap gap-2">
                    {courseHits.map((c) => (
                      <li key={c.id}>
                        <Link href={`/courses/${c.id}`} className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-meta hover:border-brand/50">
                          <BookDot title={c.title} />
                          <Highlighted text={c.title} terms={ts} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Band>
              )}

              {idx.status !== "loading" && !best && passageHits.length === 0 && courseHits.length === 0 && (
                <EmptyState title="Nothing matched" description={filtered || progress.size ? "Try loosening the filters on the left." : "Try fewer or different words."} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function BestMatch({ group, ts, reviewItems, q }: { group: ConceptGroup; ts: string[]; reviewItems: ConceptGroup["items"]; q: string }) {
  const c = group.items[0]
  const due = reviewItems.filter((i) => i.status === "due").length
  return (
    <section className="rounded-2xl border border-brand/30 bg-card p-5 sm:p-6">
      <p className="flex items-center gap-2 text-micro uppercase tracking-label text-brand">
        Best match <MatchBar share={group.share} />
      </p>
      <h2 className="mt-1 font-serif text-[1.6rem] font-semibold leading-tight">
        <Highlighted text={group.name} terms={ts} />
      </h2>
      <ConceptMarkdown content={c.signal} className="mt-2 max-w-prose text-body text-foreground/85" />
      <ul className="mt-4 flex flex-col gap-1.5">
        {group.items.map((i) => (
          <li key={i.docId} className="flex items-center gap-2 text-meta">
            <BookDot title={i.courseTitle} />
            <Link href={`/courses/${i.courseId}/concepts?concept=${encodeURIComponent(i.key)}`} className="min-w-0 truncate hover:underline">
              {i.courseTitle}
            </Link>
            <span className="shrink-0 text-micro text-muted-foreground">§ {sectionLabel(i.sectionKey)}</span>
            <StatusPill status={i.status} />
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href={reviewHref(reviewItems, q)}>
            <Layers />
            Review these {reviewItems.length} concepts{due ? ` · ${due} due` : ""}
          </Link>
        </Button>
        {group.items.length > 1 ? (
          <Button asChild variant="outline">
            <Link href={conceptGroupHref(group.name)}>Compare across {group.items.length} books</Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={chapterHref(c.courseId, c.sectionKey)}>
              <BookOpen />
              Read it in {sectionLabel(c.sectionKey)}
            </Link>
          </Button>
        )}
        <span className="text-micro text-muted-foreground">explained in {group.items.length === 1 ? "1 book" : `${group.items.length} books`}</span>
      </div>
    </section>
  )
}

function IdeaCard({ group, ts }: { group: ConceptGroup; ts: string[] }) {
  return (
    <Link href={conceptHref(group)} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand/50">
      <span className="flex items-start justify-between gap-2">
        <Highlighted text={group.name} terms={ts} className="font-medium leading-snug" />
        <MatchBar share={group.share} className="mt-0.5" />
      </span>
      <span className="line-clamp-2 text-micro text-muted-foreground">{flat(group.items[0].signal)}</span>
      <span className="mt-auto flex flex-wrap items-center gap-1.5">
        {group.items.slice(0, 4).map((i) => (
          <span key={i.docId} className="flex items-center gap-1" title={i.courseTitle}>
            <BookDot title={i.courseTitle} />
            <StatusPill status={i.status} />
          </span>
        ))}
        {group.items.length > 1 && <span className="text-micro font-medium text-brand">{group.items.length} books</span>}
      </span>
    </Link>
  )
}

function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-micro uppercase tracking-label text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

function Check({ on, radio, onClick, children }: { on: boolean; radio?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role={radio ? "radio" : "checkbox"} aria-checked={on} onClick={onClick} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted">
      <span className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center border", radio ? "rounded-full" : "rounded-[4px]", on ? "border-brand bg-brand" : "border-muted-foreground/50")}>
        {on && <span className={cn("bg-background", radio ? "h-1.5 w-1.5 rounded-full" : "h-1.5 w-1.5 rounded-[1px]")} />}
      </span>
      {children}
    </button>
  )
}

function Band({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-micro uppercase tracking-label text-muted-foreground">
        {label}
        {note && <span className="ml-2 normal-case tracking-normal opacity-70">{note}</span>}
      </h3>
      {children}
    </section>
  )
}
