"use client"

import { useState } from "react"
import { ChevronLeft, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConceptMarkdown } from "@/components/learn/concept-markdown"
import { ConceptMasteryDot } from "@/components/learn/concept-mastery-dot"
import { KIND_STYLES, prettyScope } from "@/components/learn/concept-card"
import { SectionFigures } from "@/components/learn/section-figures"
import { submitReviewGrade, type ConceptLesson, type ReviewGrade } from "@/lib/learn-service"

const GRADES: { grade: ReviewGrade; label: string; cls: string }[] = [
  { grade: 1, label: "Again", cls: "border-rose-500/40 text-rose-400 hover:bg-rose-500/10" },
  { grade: 2, label: "Hard", cls: "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" },
  { grade: 3, label: "Good", cls: "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" },
  { grade: 4, label: "Easy", cls: "border-blue-500/40 text-blue-400 hover:bg-blue-500/10" },
]

type ConceptDetailProps = {
  concept: ConceptLesson
  onBack: () => void
  onOpenConcept?: (name: string) => void
  onGraded?: () => void
  sectionTitle?: string
  docId?: string
  mastery?: number
  attempts?: number
  gate?: "mastered" | "ready" | "locked"
  blockedBy?: string[]
}

/** A focused single-concept lesson: explanation, source passage, clickable prerequisites, a
 *  reveal-on-click self-test, and self-grading (feeds the spaced-repetition schedule). */
export function ConceptDetail({
  concept: c,
  onBack,
  onOpenConcept,
  onGraded,
  sectionTitle,
  docId,
  mastery,
  attempts,
  gate,
  blockedBy,
}: ConceptDetailProps) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})
  const [graded, setGraded] = useState<string | null>(null)
  const kindClass = KIND_STYLES[c.kind] || "bg-muted text-muted-foreground"
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

      {gate === "locked" && (blockedBy || []).length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
          <span className="text-muted-foreground">
            Learn first:{" "}
            {blockedBy!.map((n, i) => (
              <span key={n}>
                {i > 0 && ", "}
                <button
                  type="button"
                  onClick={() => onOpenConcept?.(n)}
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  {n}
                </button>
              </span>
            ))}
          </span>
        </div>
      )}

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


      {(c.prereqNames || []).length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Prerequisites
          </p>
          <div className="flex flex-wrap gap-1.5">
            {c.prereqNames!.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onOpenConcept?.(n)}
                disabled={!onOpenConcept}
                className="rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-muted disabled:cursor-default disabled:hover:bg-card"
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

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
                    className="mt-2 text-xs font-medium text-nvidia-green hover:underline"
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
