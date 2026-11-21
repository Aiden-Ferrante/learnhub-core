"use client"

/** Board 4 · "⌘K inside a book": a search palette over the reader. This book / All books;
 *  in this book, concepts and passages are grouped by chapter with the chapter you are in
 *  first ("you are here"). ↑↓ move, ↵ opens (in this book without leaving the reader). */

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/kit/ui/dialog"
import { cn } from "@/kit/lib/utils"
import { chapterHref } from "@/kit/lib/scope-url"
import { flat, searchConcepts, searchHref, sectionLabel, terms } from "@/surfaces/searching/search-model"
import { BookDot, Highlighted, Kbd, StatusPill } from "@/surfaces/searching/search-ui"
import { useDebounced, usePassages, useSearchCourses, useSearchIndex } from "@/surfaces/searching/use-library-search"

type Row = { id: string; chapter: string; kind: "concept" | "passage"; title: string; detail: string; status?: Parameters<typeof StatusPill>[0]["status"]; courseId: string; courseTitle: string; docId: string; sectionKey: string }

/** "toc:8.2.3" → "8"; anything without a number → its own key. */
const chapterOf = (key: string) => /^toc:(\d+)/.exec(key)?.[1] ?? sectionLabel(key).split(" ")[0] ?? ""

export function ReaderPalette({
  course,
  scope,
  onOpenHere,
}: {
  course: { id: string; title: string; learnDocId?: string }
  /** The section being read now. */
  scope: string | null
  /** Open a section of THIS book in place. */
  onOpenHere: (sectionKey: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const [text, setText] = useState("")
  const [active, setActive] = useState(0)
  const q = useDebounced(text, 180)
  const ts = useMemo(() => terms(q), [q])
  const doc = course.learnDocId ?? null
  const { byDoc } = useSearchCourses()
  const idx = useSearchIndex(open)
  const passages = usePassages(open ? q : "", all ? null : doc, 20)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  useEffect(() => setActive(0), [q, all])

  const here = scope ? chapterOf(scope) : ""
  const rows = useMemo(() => {
    const docs = all ? null : doc ? new Set([doc]) : null
    const concepts: Row[] = searchConcepts(idx.index, q, { docIds: docs, limit: all ? 8 : 40 }).flatMap((g) =>
      (all ? g.items.slice(0, 1) : g.items).map((c) => ({
        id: `c${c.docId}${c.key}`,
        chapter: chapterOf(c.sectionKey),
        kind: "concept" as const,
        title: c.name,
        detail: flat(c.signal),
        status: c.status,
        courseId: c.courseId,
        courseTitle: c.courseTitle,
        docId: c.docId,
        sectionKey: c.sectionKey,
      })),
    )
    const found: Row[] = (passages.data?.matches ?? [])
      .filter((m) => byDoc.has(m.docId))
      .map((m) => ({
        id: `p${m.docId}${m.sectionKey}`,
        chapter: chapterOf(m.sectionKey),
        kind: "passage" as const,
        title: m.heading ? flat(m.heading) : sectionLabel(m.sectionKey),
        detail: flat(m.snippet),
        courseId: byDoc.get(m.docId)!.id,
        courseTitle: byDoc.get(m.docId)!.title,
        docId: m.docId,
        sectionKey: m.sectionKey,
      }))
    const list = [...concepts, ...found]
    if (all) return list
    // This book: by chapter, the one you are in first, then in book order.
    const n = (c: string) => (c === here ? -1 : Number(c) || 9999)
    return list.sort((a, b) => n(a.chapter) - n(b.chapter) || (a.kind === b.kind ? 0 : a.kind === "concept" ? -1 : 1))
  }, [idx.index, q, all, doc, passages.data, byDoc, here])

  const go = (r: Row) => {
    setOpen(false)
    if (r.docId === doc) onOpenHere(r.sectionKey)
    else router.push(chapterHref(r.courseId, r.sectionKey))
  }

  let lastChapter: string | null = null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12vh] max-w-[min(40rem,calc(100vw-1.5rem))] translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden">
        <DialogTitle className="sr-only">Search {all ? "all books" : course.title}</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, rows.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === "Enter" && rows[active]) {
                e.preventDefault()
                go(rows[active])
              }
            }}
            placeholder={all ? "Search all your books…" : `Search ${course.title}…`}
            aria-label="Search"
            className="h-12 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
          />
          <div role="radiogroup" aria-label="Where to search" className="flex shrink-0 rounded-lg border border-border p-0.5 text-micro">
            {[false, true].map((v) => (
              <button key={String(v)} type="button" role="radio" aria-checked={all === v} onClick={() => setAll(v)} className={cn("rounded-md px-2 py-1", all === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground")}>
                {v ? "All books" : "This book"}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {ts.length === 0 && <p className="px-3 py-4 text-meta text-muted-foreground">Type a concept or a phrase{all ? "" : " from this book"}.</p>}
          {ts.length > 0 && rows.length === 0 && (
            <p className="px-3 py-4 text-meta text-muted-foreground">{idx.status === "loading" || passages.status === "loading" ? "Searching…" : "Nothing has those words."}</p>
          )}
          {rows.map((r, i) => {
            const head = !all && r.chapter !== lastChapter
            lastChapter = r.chapter
            return (
              <div key={r.id}>
                {head && (
                  <p className="px-3 pb-1 pt-2.5 text-micro uppercase tracking-label text-muted-foreground">
                    {/^\d+$/.test(r.chapter) ? `Chapter ${r.chapter}` : r.chapter}
                    {r.chapter === here && <span className="ml-2 normal-case tracking-normal text-brand">· you are here</span>}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => go(r)}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left", i === active && "bg-muted")}
                >
                  <span className="mt-0.5 w-14 shrink-0 text-micro tabular-nums text-muted-foreground">{sectionLabel(r.sectionKey)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Highlighted text={r.title} terms={ts} className="truncate font-medium" />
                      {r.status ? <StatusPill status={r.status} /> : <span className="text-micro text-muted-foreground">passage</span>}
                    </span>
                    <span className="line-clamp-1 text-micro text-muted-foreground">
                      <Highlighted text={r.detail} terms={ts} />
                    </span>
                    {all && (
                      <span className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                        <BookDot title={r.courseTitle} />
                        <span className="truncate">{r.courseTitle}</span>
                      </span>
                    )}
                  </span>
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-micro text-muted-foreground">
          <span className="hidden items-center gap-1 sm:flex">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move · <Kbd>↵</Kbd> open · <Kbd>esc</Kbd> close
          </span>
          {ts.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                router.push(searchHref(q))
              }}
              className="ml-auto font-medium text-brand hover:underline"
            >
              Full results →
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
