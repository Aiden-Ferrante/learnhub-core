"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { prettyScope } from "@/features/learn/components/concepts/concept-card"
import { ConceptTree } from "@/features/learn/components/concepts/concept-tree"
import type { LearnTreeNode } from "@/features/learn/api/outline"
import { ConceptDetail } from "@/features/learn/components/concepts/concept-detail"
import { fetchDocumentConcepts, type ConceptLesson } from "@/features/learn/api/concepts"
import { fetchDocumentMarkdown } from "@/features/learn/api/content"
import { fetchConceptMastery, type ConceptMastery } from "@/features/learn/api/progress"
import type { Course } from "@/features/learn/lib/courses"

type ConceptsViewProps = {
  course: Course
  /** The course outline tree (toc-tree) — the concept tree reuses its skeleton. */
  tree: LearnTreeNode[]
  onBack: () => void
  /** Open straight onto this concept's detail (e.g. a concept clicked in the syllabus tree). */
  initialConceptKey?: string | null
}

type Mode = "list" | "detail"

export function ConceptsView({ course, tree, onBack, initialConceptKey }: ConceptsViewProps) {
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

  // "What can I learn next": concepts you haven't mastered yet (gate "ready").
  const ready = useMemo(
    () => concepts.filter((c) => c.conceptKey && mastery[c.conceptKey]?.gate === "ready").slice(0, 10),
    [concepts, mastery],
  )

  const lessonsByKey = useMemo(() => {
    const out: Record<string, ConceptLesson> = {}
    for (const c of concepts) if (c.conceptKey) out[c.conceptKey] = c
    return out
  }, [concepts])
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

      {!loading && !error && concepts.length > 0 && (
        <ConceptTree
          tree={tree}
          lessonsByKey={lessonsByKey}
          mastery={mastery}
          onOpenConcept={openConcept}
        />
      )}
    </div>
  )
}
