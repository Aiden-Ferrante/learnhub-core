"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, GraduationCap, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConceptCard, prettyScope } from "@/components/learn/concept-card"
import { ConceptDetail } from "@/components/learn/concept-detail"
import { ReviewPanel } from "@/components/learn/review-panel"
import {
  fetchConceptMastery,
  fetchDocumentConcepts,
  fetchDocumentMarkdown,
  type ConceptLesson,
  type ConceptMastery,
} from "@/lib/learn-service"
import type { Course } from "@/lib/courses"

type ConceptsViewProps = {
  course: Course
  onBack: () => void
  /** Open straight onto this concept's detail (e.g. a concept clicked in the syllabus tree). */
  initialConceptKey?: string | null
}

type Mode = "list" | "detail" | "session"

export function ConceptsView({ course, onBack, initialConceptKey }: ConceptsViewProps) {
  const [concepts, setConcepts] = useState<ConceptLesson[]>([])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [mastery, setMastery] = useState<Record<string, ConceptMastery>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("list")
  const [selected, setSelected] = useState<ConceptLesson | null>(null)

  const loadMastery = useCallback(() => {
    fetchConceptMastery(course.learnDocId)
      .then((m) => {
        if (!m.error) setMastery(m.byConcept || {})
      })
      .catch(() => {})
  }, [course.learnDocId])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetchDocumentConcepts(course.learnDocId)
      .then((res) => {
        if (!active) return
        if (res.error) setError(res.error)
        else setConcepts(res.concepts || [])
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Failed to load concepts"))
      .finally(() => active && setLoading(false))
    // Real section headings (best-effort) for nicer group headers.
    fetchDocumentMarkdown(course.learnDocId)
      .then((d) => {
        if (!active) return
        const map: Record<string, string> = {}
        for (const o of d.document?.outline || []) {
          if (o.sectionKey && o.title && !map[o.sectionKey]) map[o.sectionKey] = o.title
        }
        setTitles(map)
      })
      .catch(() => {})
    loadMastery()
    return () => {
      active = false
    }
  }, [course.learnDocId, loadMastery])

  const groups = useMemo(() => {
    const out: { sectionKey: string; items: { c: ConceptLesson; idx: number }[] }[] = []
    concepts.forEach((c, idx) => {
      const sk = c.sectionKey || ""
      const last = out[out.length - 1]
      if (last && last.sectionKey === sk) last.items.push({ c, idx })
      else out.push({ sectionKey: sk, items: [{ c, idx }] })
    })
    return out
  }, [concepts])

  // "What can I learn next": concepts you haven't mastered yet (gate "ready").
  const ready = useMemo(
    () => concepts.filter((c) => c.conceptKey && mastery[c.conceptKey]?.gate === "ready").slice(0, 10),
    [concepts, mastery],
  )

  const sectionLabel = (sk: string) => titles[sk] || `§${prettyScope(sk)}`
  const masteryFor = (c: ConceptLesson) => (c.conceptKey ? mastery[c.conceptKey] : undefined)
  const openConcept = (c: ConceptLesson) => {
    setSelected(c)
    setMode("detail")
  }

  // Deep-link from the syllabus tree: once concepts arrive, jump to the requested one.
  const focusedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialConceptKey || focusedRef.current === initialConceptKey || !concepts.length) return
    const found = concepts.find((c) => c.conceptKey === initialConceptKey)
    if (found) {
      focusedRef.current = initialConceptKey
      openConcept(found)
    }
  }, [initialConceptKey, concepts])

  if (mode === "session") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode("list")
              loadMastery()
            }}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> Exit
          </Button>
          <span className="text-sm font-medium">{course.title} · review</span>
        </div>
        <ReviewPanel scope={null} docId={course.learnDocId} onAnswered={loadMastery} />
      </div>
    )
  }

  if (mode === "detail" && selected) {
    const sm = masteryFor(selected)
    return (
      <ConceptDetail
        concept={selected}
        sectionTitle={titles[selected.sectionKey || ""] || prettyScope(selected.sectionKey)}
        docId={course.learnDocId}
        mastery={sm?.mastery}
        attempts={sm?.attempts}
        onBack={() => {
          setMode("list")
          loadMastery()
        }}
        onGraded={loadMastery}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Back to course
        </Button>
        <span className="text-sm font-medium">{course.title} · Concepts</span>
        <div className="ml-auto flex items-center gap-3">
          {!loading && (
            <span className="text-xs text-muted-foreground">
              {concepts.length} concept{concepts.length === 1 ? "" : "s"}
            </span>
          )}
          {concepts.length > 0 && (
            <Button size="sm" className="gap-1.5" onClick={() => setMode("session")}>
              <GraduationCap className="h-4 w-4" /> Study
            </Button>
          )}
        </div>
      </div>

      {loading && <p className="px-1 text-sm text-muted-foreground">Loading concepts…</p>}
      {error && <p className="px-1 text-sm text-destructive">{error}</p>}
      {!loading && !error && concepts.length === 0 && (
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          No concepts extracted yet. Process this document (or a chapter) to build its concept course.
        </div>
      )}

      {ready.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-brand" /> Ready to learn
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ready.map((c) => (
              <button
                key={c.conceptKey}
                type="button"
                onClick={() => openConcept(c)}
                className="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-muted"
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <section key={g.sectionKey} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {sectionLabel(g.sectionKey)}
            </h3>
            <ul className="flex flex-col gap-2">
              {g.items.map(({ c, idx }) => {
                const sm = masteryFor(c)
                return (
                  <ConceptCard
                    key={idx}
                    concept={c}
                    mastery={sm?.mastery}
                    attempts={sm?.attempts}
                    onOpen={() => openConcept(c)}
                  />
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
