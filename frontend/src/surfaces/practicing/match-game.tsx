"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, RotateCcw, Timer, Trophy } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { fetchSectionConcepts, type ConceptLesson } from "@/gateways/api/concepts"
import { recordEngagement } from "@/gateways/api/progress"
import { MathText } from "@/surfaces/reading"
import { cn } from "@/kit/lib/utils"

/** Match — the two-minute game, over concepts you already have.
 *
 *  Every other activity in the app surfaces work because it came DUE, which leaves nothing
 *  to open on a day the queue is empty. This is the opposite: no cost of entry, no
 *  consequence, and no generation — `ext_concepts` already holds the pairs.
 *
 *  DRILL ONLY. A round writes one engagement event and nothing else; it never touches
 *  `concept_reviews`, so playing can neither help nor hurt your schedule. Same contract as
 *  skeleton-practice's sort mode, and the reason this can be played carelessly. */

const PAIRS = 6
const BEST_KEY = "learnhub.match.best"

type Tile = {
  id: string
  /** The pair both tiles share — a match is two tiles with the same conceptKey. */
  conceptKey: string
  face: "term" | "definition"
  text: string
  full: string
}

/** Fisher-Yates, with the identity shuffle rejected so a "shuffled" board is never the
 *  order it was built in (the same guard skeleton-practice's sort mode uses). */
function shuffled<T>(items: T[]): T[] {
  if (items.length < 2) return [...items]
  const original = items
  let a: T[] = []
  for (let attempt = 0; attempt < 5; attempt++) {
    a = [...items]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    if (a.some((x, i) => x !== original[i])) return a
  }
  return a
}

/** Words too generic to mask on their own. Masking every component word of a multi-word
 *  term shreds unrelated prose — "Hilbert systems" turned "proof systems" into "proof —" on
 *  a real board — so a component word is only blanked when it is distinctive enough that
 *  seeing it would hand over the answer. */
const GENERIC_WORDS = new Set([
  "system", "systems", "structure", "structures", "theory", "theories", "method", "methods",
  "model", "models", "rule", "rules", "form", "forms", "effect", "effects", "value", "values",
  "function", "functions", "problem", "problems", "process", "processes", "property",
  "properties", "concept", "concepts", "principle", "principles", "notation", "number",
  "numbers", "object", "objects", "space", "spaces", "logic", "proof", "proofs", "term",
  "terms", "type", "types", "class", "classes", "order", "group", "groups", "field", "fields",
  "language", "languages", "argument", "arguments", "statement", "statements",
])

/** Hide the concept's own name inside its definition.
 *
 *  Measured on the live course: 204 of 605 signals (34%) contain their own concept name —
 *  "Fuzzy logic is a formal system…" sitting opposite a tile that reads "Fuzzy logic". A
 *  third of the board would be solvable by matching strings instead of knowing anything,
 *  which is the fastest way to make a game feel pointless.
 *
 *  The full phrase is always masked, which is exactly the leak that was measured. A single
 *  component word is masked only when it is long and not generic ("Quantifiers", yes;
 *  "systems", no) — the balance between giving the answer away and mangling the sentence
 *  the player has to read. */
export function maskConceptName(name: string, signal: string): string {
  const term = (name || "").trim()
  if (!term || !signal) return signal || ""
  const words = term.split(/\s+/)
  const distinctive = words.filter((w) => w.length >= 6 && !GENERIC_WORDS.has(w.toLowerCase()))
  // Longest-first so "propositional logic" is blanked before a component can half-match it.
  const parts = [term, ...(words.length > 1 ? distinctive : [])].sort((a, b) => b.length - a.length)
  let out = signal
  for (const p of parts) {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // Trailing `s?` so a plural in the prose ("prototype effects") is masked too.
    out = out.replace(new RegExp(`\\b${escaped}s?\\b`, "gi"), "—")
  }
  // Collapse runs left by adjacent masked words ("— —" reads as two blanks, not one).
  return out.replace(/(?:—\s*)+—/g, "—").trim()
}

function buildBoard(concepts: ConceptLesson[]): Tile[] {
  const usable = concepts.filter((c) => (c.name || "").trim() && (c.signal || "").trim())
  const picked = shuffled(usable).slice(0, PAIRS)
  const tiles: Tile[] = []
  picked.forEach((c, i) => {
    const key = c.conceptKey || `${c.name}-${i}`
    const masked = maskConceptName(c.name, c.signal)
    tiles.push({ id: `${key}:t`, conceptKey: key, face: "term", text: c.name, full: c.name })
    tiles.push({
      id: `${key}:d`,
      conceptKey: key,
      face: "definition",
      text: masked.length > 190 ? `${masked.slice(0, 190).trimEnd()}…` : masked,
      full: masked,
    })
  })
  return shuffled(tiles)
}

function formatTime(ms: number): string {
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

export function MatchGame({
  scope,
  docId,
  chapterLabel,
}: {
  scope: string
  docId?: string
  chapterLabel?: string
}) {
  const [concepts, setConcepts] = useState<ConceptLesson[]>([])
  const [tiles, setTiles] = useState<Tile[]>([])
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<string | null>(null)
  const [wrong, setWrong] = useState<[string, string] | null>(null)
  const [misses, setMisses] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [finishedMs, setFinishedMs] = useState<number | null>(null)
  const [best, setBest] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const bestKey = `${BEST_KEY}.${docId ?? "doc"}.${scope}`

  useEffect(() => {
    try {
      const raw = localStorage.getItem(bestKey)
      setBest(raw ? Number(raw) : null)
    } catch {
      setBest(null)
    }
  }, [bestKey])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetchSectionConcepts(scope, docId)
      .then((res) => {
        if (!active) return
        const list = res.concepts ?? []
        setConcepts(list)
        setTiles(buildBoard(list))
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Could not load this chapter's concepts")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [scope, docId])

  // The clock ticks only while a round is live; it is display state, never scored.
  useEffect(() => {
    if (startedAt == null || finishedMs != null) return
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 100)
    return () => clearInterval(t)
  }, [startedAt, finishedMs])

  useEffect(() => () => {
    if (wrongTimer.current) clearTimeout(wrongTimer.current)
  }, [])

  const newRound = useCallback(() => {
    if (wrongTimer.current) clearTimeout(wrongTimer.current)
    setTiles(buildBoard(concepts))
    setMatched(new Set())
    setPicked(null)
    setWrong(null)
    setMisses(0)
    setStartedAt(null)
    setElapsed(0)
    setFinishedMs(null)
  }, [concepts])

  const finish = useCallback(
    (ms: number) => {
      setFinishedMs(ms)
      // The only thing a round writes anywhere: one engagement event. No FSRS, no grade.
      recordEngagement("game", scope, docId)
      setBest((prev) => {
        if (prev != null && prev <= ms) return prev
        try {
          localStorage.setItem(bestKey, String(ms))
        } catch {
          // a browser without storage still plays; it just forgets
        }
        return ms
      })
    },
    [scope, docId, bestKey],
  )

  const tap = useCallback(
    (tile: Tile) => {
      if (matched.has(tile.conceptKey) || finishedMs != null) return
      const began = startedAt ?? Date.now()
      if (startedAt == null) setStartedAt(began)

      if (picked === null) {
        setPicked(tile.id)
        return
      }
      if (picked === tile.id) {
        setPicked(null) // tapping the same tile deselects
        return
      }
      const other = tiles.find((t) => t.id === picked)
      if (!other) {
        setPicked(tile.id)
        return
      }
      if (other.conceptKey === tile.conceptKey) {
        const next = new Set(matched).add(tile.conceptKey)
        setMatched(next)
        setPicked(null)
        if (next.size === tiles.length / 2) finish(Date.now() - began)
      } else {
        setMisses((m) => m + 1)
        setWrong([other.id, tile.id])
        setPicked(null)
        if (wrongTimer.current) clearTimeout(wrongTimer.current)
        wrongTimer.current = setTimeout(() => setWrong(null), 550)
      }
    },
    [matched, picked, tiles, startedAt, finishedMs, finish],
  )

  if (loading)
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Dealing the board…
      </div>
    )
  if (error) return <p className="rounded-lg border bg-card p-6 text-sm text-destructive">{error}</p>

  if (tiles.length < 4)
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-base font-medium">Not enough concepts in this chapter to play.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Match needs at least two concepts with definitions
          {chapterLabel ? ` — ${chapterLabel} has ${concepts.length}.` : "."} Extract this
          chapter&rsquo;s concepts first.
        </p>
      </div>
    )

  const done = finishedMs != null
  const shownMs = finishedMs ?? elapsed

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5 tabular-nums">
          <Timer className="h-4 w-4 text-muted-foreground" />
          {formatTime(shownMs)}
        </span>
        <span className="text-muted-foreground">
          {matched.size}/{tiles.length / 2} pairs
        </span>
        {misses > 0 && <span className="text-muted-foreground">· {misses} misses</span>}
        {best != null && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" />
            best {formatTime(best)}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 px-2 text-xs"
          onClick={newRound}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          New board
        </Button>
      </div>

      {done && (
        <p className="rounded border border-emerald-500/40 bg-emerald-500/5 px-4 py-2 text-sm">
          Cleared in <strong className="tabular-nums">{formatTime(finishedMs)}</strong>
          {misses === 0 ? " with no misses" : ` with ${misses} miss${misses === 1 ? "" : "es"}`}
          {best != null && finishedMs <= best ? " — a new best." : "."}{" "}
          <button type="button" className="underline" onClick={newRound}>
            Go again
          </button>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const isMatched = matched.has(t.conceptKey)
          const isPicked = picked === t.id
          const isWrong = !!wrong && (wrong[0] === t.id || wrong[1] === t.id)
          return (
            <button
              key={t.id}
              type="button"
              disabled={isMatched}
              title={t.full}
              onClick={() => tap(t)}
              className={cn(
                "flex min-h-[7rem] items-center justify-center rounded-lg border p-3 text-center transition-all",
                t.face === "term" ? "text-sm font-medium" : "text-xs leading-snug",
                isMatched && "pointer-events-none border-dashed border-border/40 opacity-0",
                !isMatched && isWrong && "border-rose-500/60 bg-rose-500/10 text-rose-300",
                !isMatched && !isWrong && isPicked && "border-brand bg-brand/15 ring-1 ring-brand",
                !isMatched && !isWrong && !isPicked && "hover:border-foreground/40 hover:bg-muted/40",
              )}
            >
              {/* Concept signals carry TeX — a real board showed "$P \rightarrow Q$" as
                  "$P ightarrow Q$". MathText is the renderer built for this layer. */}
              {t.face === "term" ? (
                <span className="line-clamp-5">{t.text}</span>
              ) : (
                <MathText text={t.text} className="line-clamp-5" />
              )}
            </button>
          )
        })}
      </div>

      <p className="text-micro text-muted-foreground">
        Drill only — Match never changes your review schedule.
      </p>
    </div>
  )
}
