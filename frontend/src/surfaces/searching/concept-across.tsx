"use client"

/** Board 3 · "One idea across your books": /search/concept?name=… — the same concept as each
 *  book defines it, side by side with your status in each; the ideas each book explains
 *  around it (the other concepts in the same sections); and one review of them all.
 *  "Where the books disagree" needs generated comparison, so it waits with meaning search. */

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { BookOpen, Layers } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { chapterHref } from "@/kit/lib/scope-url"
import { EmptyState } from "@/kit/patterns/empty-state"
import { ConceptMarkdown } from "@/surfaces/concepts"
import { conceptHref } from "@/surfaces/searching/library-search-box"
import { groupByName, nameKey, reviewHref, searchConcepts, sectionLabel, type ConceptGroup } from "@/surfaces/searching/search-model"
import { BookDot, StatusPill } from "@/surfaces/searching/search-ui"
import { useSearchIndex } from "@/surfaces/searching/use-library-search"

export function ConceptAcross() {
  const name = useSearchParams().get("name") ?? ""
  const idx = useSearchIndex()
  const byName = useMemo(() => groupByName(idx.index), [idx.index])
  const items = useMemo(() => byName.get(nameKey(name)) ?? searchConcepts(idx.index, name, { limit: 1 })[0]?.items ?? [], [byName, idx.index, name])

  // Around this idea: what each book explains in the same section, grouped across books.
  const around = useMemo(() => {
    // Same section, or a section inside it / around it ("toc:2" holds "toc:2.3").
    const near = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)
    const self = new Set(items.map((i) => i.key))
    const out = new Map<string, ConceptGroup>()
    for (const c of idx.index) {
      if (self.has(c.key) || !items.some((i) => i.docId === c.docId && near(i.sectionKey, c.sectionKey))) continue
      const id = nameKey(c.name)
      const g = out.get(id)
      if (!g) out.set(id, { id, name: c.name, items: (byName.get(id) ?? [c]).slice(), score: 0, share: 1 })
    }
    return Array.from(out.values()).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)).slice(0, 18)
  }, [idx.index, items, byName])

  if (idx.status === "loading") return <p className="text-meta text-muted-foreground">Looking through your books…</p>
  if (!items.length) return <EmptyState title="No concept by that name" description={`None of your books names “${name}” as a concept.`} />

  const due = items.filter((i) => i.status === "due").length
  const title = items[0].name

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="text-micro uppercase tracking-label text-muted-foreground">One idea across your books</p>
          <h1 className="font-serif text-[1.9rem] font-semibold leading-tight">{title}</h1>
          <p className="text-meta text-muted-foreground">
            {items.length === 1 ? "Explained in 1 book" : `Explained in ${items.length} books`}, as each one puts it
          </p>
        </div>
        <Button asChild>
          <Link href={reviewHref(items, title)}>
            <Layers />
            Review all {items.length}
            {due ? ` · ${due} due` : ""}
          </Link>
        </Button>
      </header>

      <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
        {items.map((i) => (
          <article key={i.docId} className="flex w-[19rem] shrink-0 snap-start flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:w-[21rem]">
            <p className="flex items-center gap-2 text-micro text-muted-foreground">
              <BookDot title={i.courseTitle} />
              <span className="min-w-0 truncate" title={i.courseTitle}>
                {i.courseTitle}
              </span>
              <StatusPill status={i.status} className="ml-auto" />
            </p>
            <p className="text-micro text-muted-foreground">
              § {sectionLabel(i.sectionKey)}
              {i.pageStart ? ` · p. ${i.pageStart}` : ""} · {i.kind}
            </p>
            <ConceptMarkdown content={i.signal} className="text-body text-foreground/90" />
            {i.source && i.source !== i.signal && (
              <blockquote className="border-l-2 border-border pl-3 text-meta italic text-muted-foreground">
                <ConceptMarkdown content={i.source} />
              </blockquote>
            )}
            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" variant="outline">
                <Link href={chapterHref(i.courseId, i.sectionKey)}>
                  <BookOpen />
                  Read
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href={`/courses/${i.courseId}/concepts?concept=${encodeURIComponent(i.key)}`}>Lesson</Link>
              </Button>
            </div>
          </article>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex flex-col gap-3">
          <h2 className="text-micro uppercase tracking-label text-muted-foreground">
            Around this idea <span className="ml-1 normal-case tracking-normal opacity-70">explained in the same part of each book</span>
          </h2>
          {around.length === 0 ? (
            <p className="text-meta text-muted-foreground">Nothing else is explained alongside it.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {around.map((g) => (
                <Link key={g.id} href={conceptHref(g)} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-meta hover:border-brand/50">
                  {g.name}
                  <StatusPill status={g.items[0].status} />
                  {g.items.length > 1 && <span className="text-micro text-brand">{g.items.length} books</span>}
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-2xl border border-dashed border-border p-5 text-meta text-muted-foreground">
          <p className="text-micro uppercase tracking-label">Where the books disagree</p>
          <p className="mt-1.5">Comes with meaning search: it needs a model to compare how each book explains this.</p>
        </section>
      </div>
    </div>
  )
}
