"use client"

/** The chapter Review's top page (v0.32.0, human 2026-11-21): the master list of the chapter's
 *  concepts as a tree you expand per subchapter, a checkbox per subchapter to choose what the
 *  review pools from, and a block length (10–25 min) so a long chapter is done in pieces.
 *  A block takes due concepts first, then new ones, then the rest, in book order. */

import { ChevronRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "@/kit/lib/utils"
import type { LearnConcept } from "@/surfaces/studying/learn/learn-model"

export type ConceptStatus = "due" | "new" | "learned"
export type ReviewGroup = { id: string; label: string; concepts: LearnConcept[] }

export const BLOCKS = [10, 15, 20, 25] as const
/** About a minute and a half per concept: one pick, one written explanation. */
export const MIN_PER_CONCEPT = 1.5

const STATUS: Record<ConceptStatus, { text: string; cls: string }> = {
  due: { text: "Due", cls: "text-ink-warn" },
  new: { text: "New", cls: "text-muted-foreground" },
  learned: { text: "Learned", cls: "text-ink-ok" },
}

/** The concepts one block takes from the chosen groups: due → new → learned, book order within. */
export function pickBlock(groups: ReviewGroup[], status: (k: string) => ConceptStatus, minutes: number): LearnConcept[] {
  const all = groups.flatMap((g) => g.concepts)
  const rank: Record<ConceptStatus, number> = { due: 0, new: 1, learned: 2 }
  const ordered = all.map((c, i) => ({ c, i })).sort((a, b) => rank[status(a.c.key)] - rank[status(b.c.key)] || a.i - b.i)
  return ordered.slice(0, Math.max(1, Math.floor(minutes / MIN_PER_CONCEPT))).map((x) => x.c)
}

export function ReviewSetup({
  storageKey,
  title,
  eyebrow,
  groups,
  status,
  onStart,
  note,
}: {
  storageKey: string
  title: string
  eyebrow: string
  groups: ReviewGroup[]
  status: (key: string) => ConceptStatus
  onStart: (concepts: LearnConcept[], minutes: number, groupIds: string[]) => void
  /** A line above the start button, e.g. what the last block did. */
  note?: React.ReactNode
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(groups.map((g) => g.id)))
  const [minutes, setMinutes] = useState<number>(15)
  const [open, setOpen] = useState<Set<string>>(new Set())

  // Remember the selection and block length per chapter.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { groups?: string[]; minutes?: number } | null
      if (saved?.groups) setChosen(new Set(saved.groups.filter((id) => groups.some((g) => g.id === id))))
      if (saved?.minutes && (BLOCKS as readonly number[]).includes(saved.minutes)) setMinutes(saved.minutes)
    } catch {
      /* a bad entry is ignored */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per chapter
  }, [storageKey])
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ groups: Array.from(chosen), minutes }))
  }, [storageKey, chosen, minutes])

  const count = (cs: LearnConcept[], s: ConceptStatus) => cs.filter((c) => status(c.key) === s).length
  const all = groups.flatMap((g) => g.concepts)
  const picked = groups.filter((g) => chosen.has(g.id))
  const pool = picked.flatMap((g) => g.concepts)
  const block = useMemo(() => pickBlock(picked, status, minutes), [picked, status, minutes])
  const blocksLeft = pool.length ? Math.ceil(pool.length / Math.max(1, Math.floor(minutes / MIN_PER_CONCEPT))) : 0

  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }

  return (
    <div className="flex flex-wrap gap-8">
      <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-accent">{eyebrow}</span>
          <h1 className="m-0 font-serif text-[30px] font-semibold leading-tight">{title}</h1>
          <p className="m-0 text-sm text-muted-foreground">
            {all.length} concepts · <span className="text-ink-warn">{count(all, "due")} due</span> · {count(all, "new")} new ·{" "}
            <span className="text-ink-ok">{count(all, "learned")} learned</span>
          </p>
        </header>

        <div className="flex items-center justify-between gap-3 text-meta text-muted-foreground">
          <span>Choose the subchapters to review from</span>
          <span className="flex gap-3">
            <button type="button" className="hover:text-foreground" onClick={() => setChosen(new Set(groups.map((g) => g.id)))}>
              All
            </button>
            <button type="button" className="hover:text-foreground" onClick={() => setChosen(new Set())}>
              None
            </button>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setOpen(open.size === groups.length ? new Set() : new Set(groups.map((g) => g.id)))}
            >
              {open.size === groups.length ? "Collapse all" : "Expand all"}
            </button>
          </span>
        </div>

        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl border border-border bg-card p-0">
          {groups.map((g, gi) => {
            const isOpen = open.has(g.id)
            const isChosen = chosen.has(g.id)
            const d = count(g.concepts, "due")
            const nw = count(g.concepts, "new")
            const l = count(g.concepts, "learned")
            return (
              <li key={g.id} className={cn(gi > 0 && "border-t border-border")}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <input
                    id={`grp-${g.id}`}
                    type="checkbox"
                    checked={isChosen}
                    onChange={() => setChosen(toggle(chosen, g.id))}
                    className="h-[18px] w-[18px] shrink-0 accent-[hsl(var(--primary))]"
                  />
                  <button
                    type="button"
                    onClick={() => setOpen(toggle(open, g.id))}
                    aria-expanded={isOpen}
                    aria-controls={`grp-list-${g.id}`}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                    <span className={cn("min-w-0 flex-1 truncate font-serif text-[17px] font-semibold", !isChosen && "text-muted-foreground")}>
                      {g.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5 text-meta tabular-nums">
                      <span className="text-muted-foreground">{g.concepts.length}</span>
                      {d > 0 && <span className="text-ink-warn">{d} due</span>}
                      {nw > 0 && <span className="text-muted-foreground">{nw} new</span>}
                      {l > 0 && <span className="text-ink-ok">{l} learned</span>}
                    </span>
                  </button>
                  <label htmlFor={`grp-${g.id}`} className="sr-only">
                    Review {g.label}
                  </label>
                </div>
                {/* the subchapter's mastery bar */}
                <div className="mx-4 mb-2.5 flex h-1 overflow-hidden rounded-full bg-muted">
                  <span className="bg-status-mastered" style={{ width: `${(l / Math.max(1, g.concepts.length)) * 100}%` }} />
                  <span className="bg-status-due" style={{ width: `${(d / Math.max(1, g.concepts.length)) * 100}%` }} />
                </div>
                {isOpen && (
                  <ul id={`grp-list-${g.id}`} className="m-0 flex list-none flex-col gap-0.5 border-t border-border/60 bg-background/40 px-4 py-2 pl-[3.75rem]">
                    {g.concepts.map((c) => {
                      const st = STATUS[status(c.key)]
                      return (
                        <li key={c.key} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                          <span className="min-w-0">
                            {c.name}
                            <span className="ml-2 text-[11px] uppercase tracking-wider text-muted-foreground">{c.kind}</span>
                          </span>
                          <span className={cn("shrink-0 text-meta", st.cls)}>{st.text}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <aside className="flex flex-[1_1_300px] flex-col gap-5 self-start rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-24">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Block length</span>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Block length">
            {BLOCKS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                onClick={() => setMinutes(m)}
                className={cn(
                  "min-h-11 rounded-lg border text-sm font-semibold tabular-nums",
                  minutes === m ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">
            {block.length && pool.length ? `${block.length} concept${block.length === 1 ? "" : "s"} this block` : "Nothing chosen"}
          </span>
          <span className="text-muted-foreground">
            {pool.length
              ? `from ${picked.length} subchapter${picked.length === 1 ? "" : "s"} · ${pool.length} in the pool · about ${blocksLeft} block${blocksLeft === 1 ? "" : "s"} for all`
              : "Tick at least one subchapter."}
          </span>
          {pool.length > 0 && (
            <span className="text-muted-foreground">
              {count(block, "due") > 0 ? `${count(block, "due")} due first, then ` : ""}
              {count(block, "new") > 0 ? `${count(block, "new")} new` : "concepts you've learned"}
            </span>
          )}
        </div>
        {note}
        <button
          type="button"
          disabled={!pool.length}
          onClick={() => onStart(block, minutes, Array.from(chosen))}
          className="min-h-12 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          Start a {minutes}-minute block
        </button>
        <span className="text-xs text-muted-foreground">Each concept: pick its definition, then explain it and grade yourself.</span>
      </aside>
    </div>
  )
}
