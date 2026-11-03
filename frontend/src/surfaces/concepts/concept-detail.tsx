"use client"

import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { GRADE_INVALIDATES, useApiMutation } from "@/kit/data"
import { GradeButtons, Sheet } from "@/kit/study"
import { cn } from "@/kit/lib/utils"
import { ConceptMarkdown } from "@/surfaces/concepts/concept-markdown"
import { ConceptMasteryDot } from "@/surfaces/concepts/concept-mastery-dot"
import { prettyScope } from "@/surfaces/concepts/concept-format"
import { KIND_BADGE } from "@/surfaces/concepts/kind-palette"
import { SectionFigures } from "@/surfaces/reading"
import type { ConceptMastery } from "@/gateways/api/progress"
import type { ConceptLesson } from "@/gateways/api/concepts"
import { submitReviewGrade, type ReviewGrade } from "@/gateways/api/review"

const label = "text-micro font-medium uppercase tracking-label text-muted-foreground"

/** A focused single-concept lesson: explanation, source passage, a reveal-on-click
 *  self-test, and self-grading (feeds the spaced-repetition schedule). The grade is a
 *  write: it says "Scheduled" only once the server took it, and "Not saved · Retry" if not. */
export function ConceptDetail({ concept: c, sectionTitle, docId, memory, onClose }: {
  concept: ConceptLesson
  sectionTitle?: string
  docId?: string
  memory?: ConceptMastery
  /** Back to the concept list (the breadcrumbs end at Concepts, so they can't). */
  onClose: () => void
}) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})
  const [lastGrade, setLastGrade] = useState<ReviewGrade | null>(null)
  const kindClass = KIND_BADGE[c.kind] || "bg-muted text-muted-foreground"
  const where = sectionTitle || prettyScope(c.sectionKey)
  const elsewhere = (c.appearsIn || []).filter((p) => p.sectionKey !== c.sectionKey)

  const grade = useApiMutation(
    (g: ReviewGrade) => submitReviewGrade(c.conceptKey as string, g, docId),
    { invalidates: GRADE_INVALIDATES },
  )
  const send = (g: ReviewGrade) => {
    setLastGrade(g)
    grade.fire(g)
  }
  const days = grade.data?.intervalDays ? Math.round(grade.data.intervalDays) : 0

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="self-start" onClick={onClose}>
        All concepts
      </Button>

      <Sheet as="article">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {memory !== undefined && <ConceptMasteryDot state={memory.state} retention={memory.retention} />}
            <h1 className="text-xl font-semibold leading-tight">{c.name}</h1>
            <span className={cn("rounded px-1.5 py-0.5 text-micro font-medium uppercase", kindClass)}>{c.kind}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {where}
            {c.pageStart ? ` · p.${c.pageStart}` : ""}
            {elsewhere.length > 0 && ` · also in ${elsewhere.map((p) => "§" + prettyScope(p.sectionKey)).join(", ")}`}
          </p>
        </div>

        <ConceptMarkdown content={c.signal} className="text-title leading-relaxed" />

        {c.source && (
          <div className="rounded-md border p-3">
            <p className={cn(label, "mb-1")}>From the text</p>
            <ConceptMarkdown content={c.source} className="text-sm italic text-muted-foreground" />
          </div>
        )}

        <SectionFigures
          docId={docId}
          sectionKey={c.sectionKey}
          pageStart={c.pageStart}
          pageEnd={c.pageEnd}
          limit={2}
          className="grid gap-3 sm:grid-cols-2"
        />
      </Sheet>

      {(c.questions || []).length > 0 && (
        <Sheet title="Test yourself">
          <ul className="flex flex-col gap-2">
            {c.questions!.map((q, i) => (
              <li key={i} className="rounded-md border p-3">
                <p className="text-sm font-medium">{q.q}</p>
                {revealed[i] ? (
                  <p className="mt-2 text-sm text-muted-foreground">{q.a}</p>
                ) : (
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-1 h-auto p-0 text-xs text-ink-accent"
                    onClick={() => setRevealed((r) => ({ ...r, [i]: true }))}
                  >
                    Show answer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Sheet>
      )}

      {c.conceptKey && (
        <Sheet title="How well did you recall this?">
          {grade.data ? (
            <p className="text-sm text-ink-ok">
              {days > 0 ? `Scheduled · next in ${days} day${days === 1 ? "" : "s"}` : "Recorded"}
            </p>
          ) : (
            <GradeButtons
              hints={false}
              onGrade={send}
              pending={grade.pending}
              error={grade.error}
              onRetry={lastGrade ? () => send(lastGrade) : undefined}
            />
          )}
        </Sheet>
      )}
    </div>
  )
}
