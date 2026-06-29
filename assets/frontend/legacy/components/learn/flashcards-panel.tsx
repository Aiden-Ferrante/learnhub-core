"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fetchDeck, type Flashcard } from "@/lib/learn-service"

type FlashcardsPanelProps = {
  scope: string | null
  doc?: string
}

export function FlashcardsPanel({ scope, doc }: FlashcardsPanelProps) {
  const [cards, setCards] = useState<Flashcard[]>([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [known, setKnown] = useState(0)
  const [skipped, setSkipped] = useState(0)

  const loadDeck = useCallback(async () => {
    setLoading(true)
    setError(null)
    setIndex(0)
    setFlipped(false)
    try {
      const data = await fetchDeck(scope, 20, doc)
      if (data.error) throw new Error(data.error)
      setCards(data.cards)
      if (data.cards.length === 0) {
        setError("No flashcards in this scope. Try another section or process more triples.")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deck")
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [scope, doc])

  useEffect(() => {
    loadDeck()
  }, [loadDeck])

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, cards.length - 1))
    setFlipped(false)
  }, [cards.length])

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0))
    setFlipped(false)
  }, [])

  const markKnown = useCallback(() => {
    setKnown((k) => k + 1)
    goNext()
  }, [goNext])

  const markSkipped = useCallback(() => {
    setSkipped((s) => s + 1)
    goNext()
  }, [goNext])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t?.isContentEditable
      ) {
        return
      }
      const k = e.key.toLowerCase()
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault()
        setFlipped((f) => !f)
      } else if (e.key === "ArrowRight") {
        goNext()
      } else if (e.key === "ArrowLeft") {
        goPrev()
      } else if (k === "k") {
        markKnown()
      } else if (k === "s") {
        markSkipped()
      } else if (k === "r") {
        loadDeck()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [goNext, goPrev, markKnown, markSkipped, loadDeck])

  const card = cards[index]

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading flashcards…
      </div>
    )
  }

  if (error || !card) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-destructive">{error || "No cards"}</p>
        <Button type="button" variant="outline" size="sm" onClick={loadDeck}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-4 gap-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Card {index + 1} / {cards.length}
          {scope ? ` · ${scope}` : ""}
        </span>
        <span>
          Known {known} · Skipped {skipped}
        </span>
      </div>

      <button
        type="button"
        className="flex-1 min-h-[200px] rounded-lg border bg-card p-6 text-left shadow-sm hover:border-nvidia-green/40 transition-colors"
        onClick={() => setFlipped((f) => !f)}
      >
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
          {flipped ? "Answer" : "Question"} — click or Space to flip
        </p>
        <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
          {flipped ? card.back : card.front}
        </pre>
      </button>

      <div className="flex flex-wrap gap-2 justify-between">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index === 0}
            onClick={goPrev}
            title="Previous (←)"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index >= cards.length - 1}
            onClick={goNext}
            title="Next (→)"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={markKnown} title="Known (K)">
            Known
            <kbd className="ml-1.5 rounded border border-current/30 px-1 text-[10px] opacity-70">K</kbd>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={markSkipped} title="Skip (S)">
            Skip
            <kbd className="ml-1.5 rounded border border-current/30 px-1 text-[10px] opacity-70">S</kbd>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={loadDeck} title="Reload deck (R)">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
