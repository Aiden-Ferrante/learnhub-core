"use client"

import { useState } from "react"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConceptMarkdown } from "@/features/learn/components/concepts/concept-markdown"
import { ConceptMasteryDot } from "@/features/learn/components/concepts/concept-mastery-dot"
import { prettyScope } from "@/features/learn/components/concepts/concept-card"
import { KIND_BADGE } from "@/features/learn/components/concepts/kind-palette"
import { SectionFigures } from "@/features/learn/components/reader/section-figures"
import { type ConceptLesson } from "@/features/learn/api/concepts"
import { submitReviewGrade, type ReviewGrade } from "@/features/learn/api/review"
import { GRADES } from "@/features/learn/components/study/grade-scale"

type ConceptDetailProps = {
  concept: ConceptLesson
  onBack: () => void
  onGraded?: () => void
  sectionTitle?: string
  docId?: string
  mastery?: number
  attempts?: number
}

/** A focused single-concept lesson: explanation, source passage, a reveal-on-click
 *  self-test, and self-grading (feeds the spaced-repetition schedule). */
export function ConceptDetail({
  concept: c,
  onBack,
  onGraded,
  sectionTitle,
  docId,
  mastery,
  attempts,
}: ConceptDetailProps) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})
  const [graded, setGraded] = useState<string | null>(null)
  const kindClass = KIND_BADGE[c.kind] || "bg-muted text-muted-foreground"
  const where = sectionTitle || prettyScope(c.sectionKey)
  const elsewhere = (c.appearsIn || []).filter((p) => p.sectionKey !== c.sectionKey)

  const grade = (g: ReviewGrade) => {
    if (!c.conceptKey) return
    submitReviewGrade(c.conceptKey, g, docId)
      .then((r) => {
        const days = r.intervalDays ? Math.round(r.intervalDays) : 0
        setGraded(days > 0 ? `Scheduled — next in ${days} day${days === 1 ? "" : "s"}` : "Recorded")
      })
      .catch(() => setGraded("Recorded"))
    onGraded?.()
  }

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 self-start">
        <ChevronLeft className="h-4 w-4" /> Back
      </Button>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {mastery !== undefined && <ConceptMasteryDot mastery={mastery} attempts={attempts} />}
          <h2 className="text-xl font-semibold leading-tight">{c.name}</h2>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${kindClass}`}>
            {c.kind}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {where}
          {c.pageStart ? ` · p.${c.pageStart}` : ""}
          {elsewhere.length > 0 &&
            ` · also in ${elsewhere.map((p) => "§" + prettyScope(p.sectionKey)).join(", ")}`}
        </p>
      </div>

      <ConceptMarkdown content={c.signal} className="text-[15px] leading-relaxed" />

      {c.source && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            From the text
          </p>
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


      {(c.questions || []).length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Test yourself
          </p>
          <ul className="flex flex-col gap-2">
            {c.questions!.map((q, i) => (
              <li key={i} className="rounded-lg border bg-card p-3">
                <p className="text-sm font-medium">{q.q}</p>
                {revealed[i] ? (
                  <p className="mt-2 text-sm text-muted-foreground">{q.a}</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [i]: true }))}
                    className="mt-2 text-xs font-medium text-brand hover:underline"
                  >
                    Show answer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.conceptKey && (
        <div className="border-t pt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            How well did you recall this?
          </p>
          {graded ? (
            <p className="text-sm text-emerald-400">{graded}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {GRADES.map(({ grade: g, label, cls }) => (
                <Button key={g} type="button" variant="outline" className={cls} onClick={() => grade(g)}>
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
