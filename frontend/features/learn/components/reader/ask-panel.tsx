"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, Loader2, Search, Sparkles } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  askTextbook,
  buildSearchIndex,
  fetchSearchIndexStatus,
  semanticSearch,
  type AskResponse,
  type SearchMatch,
  type SemanticSearchResponse,
} from "@/features/learn/api"
import type { Course } from "@/features/learn/lib/courses"

type Mode = "ask" | "search"

type AskPanelProps = {
  course: Course
  onBack: () => void
  /** Jump to a source section (opens it in the lesson/reader). */
  onOpenSection: (scope: string | null) => void
}

/** Ask-your-textbook: a keyless semantic search + grounded, cited answer over the book's content. */
export function AskPanel({ course, onBack, onOpenSection }: AskPanelProps) {
  const doc = course.learnDocId ?? course.id
  const [mode, setMode] = useState<Mode>("ask")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<AskResponse | null>(null)
  const [results, setResults] = useState<SemanticSearchResponse | null>(null)
  const [index, setIndex] = useState<{ total: number; indexed: number } | null>(null)
  const [indexing, setIndexing] = useState(false)

  useEffect(() => {
    let active = true
    fetchSearchIndexStatus(doc)
      .then((s) => active && !s.error && setIndex({ total: s.total, indexed: s.indexed }))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [doc])

  const needsIndex = !!index && index.total > 0 && index.indexed < index.total

  const run = async () => {
    if (!query.trim() || loading) return
    setLoading(true)
    setAnswer(null)
    setResults(null)
    try {
      if (mode === "ask") setAnswer(await askTextbook(doc, query))
      else setResults(await semanticSearch(doc, query))
    } finally {
      setLoading(false)
    }
  }

  const doIndex = async () => {
    setIndexing(true)
    try {
      const s = await buildSearchIndex(doc)
      if (!s.error) setIndex({ total: s.total, indexed: s.indexed })
    } finally {
      setIndexing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to course
        </button>
        <span className="text-sm font-medium">{course.title}</span>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Ask this book</h2>
        <p className="text-sm text-muted-foreground">
          Search by meaning or get a grounded answer — drawn only from this book, with citations.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
        {(["ask", "search"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === m ? "bg-brand/10 text-brand" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "ask" ? <Sparkles className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
            {m === "ask" ? "Ask" : "Search"}
          </button>
        ))}
      </div>

      {/* Query box */}
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder={mode === "ask" ? "Ask a question about this book…" : "Search for a topic or idea…"}
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
        />
        <button
          type="button"
          onClick={run}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "ask" ? "Ask" : "Search"}
        </button>
      </div>

      {/* Index hint */}
      {needsIndex && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {index!.indexed === 0
              ? "This book isn't indexed for search yet."
              : `Indexed ${index!.indexed}/${index!.total} blocks.`}
          </span>
          <button
            type="button"
            onClick={doIndex}
            disabled={indexing}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {indexing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Build index
          </button>
        </div>
      )}

      {/* Grounded answer */}
      {answer && (
        <div className="space-y-4">
          {answer.error ? (
            <p className="text-sm text-destructive">{answer.error}</p>
          ) : (
            <>
              <div className="prose prose-sm max-w-none rounded-lg border bg-card p-4 dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.answer ?? ""}</ReactMarkdown>
              </div>
              {answer.citations?.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Sources
                  </p>
                  <ul className="space-y-1">
                    {answer.citations.map((c) => (
                      <li key={c.n}>
                        <button
                          type="button"
                          onClick={() => onOpenSection(c.sectionKey)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                        >
                          <span className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                            {c.n}
                          </span>
                          <span className="truncate">{c.heading || c.sectionKey}</span>
                          {c.page != null && (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">p.{c.page}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Search results */}
      {results && (
        <div className="space-y-2">
          {results.error ? (
            <p className="text-sm text-destructive">{results.error}</p>
          ) : results.matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{results.hint || "No matches."}</p>
          ) : (
            results.matches.map((m: SearchMatch, i) => (
              <button
                key={`${m.sectionKey}-${i}`}
                type="button"
                onClick={() => onOpenSection(m.sectionKey)}
                className="block w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-brand/40"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{m.heading || m.sectionKey}</span>
                  {m.pageStart != null && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">p.{m.pageStart}</span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.snippet}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
