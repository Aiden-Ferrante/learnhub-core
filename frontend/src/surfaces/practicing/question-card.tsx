"use client"

import { useRef, useState } from "react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data"
import { Choice, Note, Sheet } from "@/kit/study"
import type { LearnQuestion } from "@/gateways/api/packs"
import { Prose, Walk, cite } from "@/surfaces/practicing/pack-shared"
import { useGradeSkill } from "@/surfaces/practicing/use-pack"

const ORIGIN: Record<LearnQuestion["origin"], string> = {
  book_problem: "book problem",
  variant: "variant of book problem",
  generated: "generated",
}

/** A choice question marked on the spot, or a problem with no key that you check
 *  yourself. Either way the skill's grade is a write: `onAnswered` runs only once it
 *  landed, and a failure says "Not saved · Retry" on the card. */
export function QuestionCard({ q, packKey, onAnswered }: { q: LearnQuestion; packKey: string; onAnswered?: (ok: boolean) => void }) {
  const [pick, setPick] = useState<number | null>(null)
  const [shown, setShown] = useState(false)
  const [selfMarked, setSelfMarked] = useState(false)
  const last = useRef<boolean | null>(null)
  const key = typeof q.answer === "number" ? q.answer : null
  const hasChoices = (q.choices?.length ?? 0) > 0 && key != null

  const grade = useGradeSkill(packKey, q.skill, (ok) => {
    setSelfMarked(true)
    onAnswered?.(ok)
  })
  const send = (ok: boolean) => {
    last.current = ok
    grade.fire(ok)
  }

  const choose = (i: number) => {
    if (pick != null) return
    setPick(i)
    send(i === key)
  }
  const stateOf = (i: number) =>
    pick == null ? "idle" : i === key ? "right" : pick === i ? "wrong" : "idle"
  const missed = pick != null && pick !== key

  return (
    <Sheet as="article">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{q.skillLabel}</span>
        <span className="font-mono">{ORIGIN[q.origin] ?? q.origin} · {cite(q.sectionKey)}</span>
      </div>
      <Prose text={q.stem} />
      {hasChoices ? (
        <div className="flex flex-col gap-2">
          {q.choices?.map((c, i) => (
            <Choice key={i} index={i} state={stateOf(i)} disabled={pick != null} onClick={() => choose(i)}>
              <span className="whitespace-pre-wrap">{c}</span>
            </Choice>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {(q.choices ?? []).map((c, i) => <div key={i} className="text-sm">{"ABCDE"[i]}. {c}</div>)}
          {!shown ? (
            <div><Button variant="outline" size="sm" onClick={() => setShown(true)}>Show answer</Button></div>
          ) : (
            <>
              {q.printedAnswer ? (
                <Note>{q.printedAnswer}</Note>
              ) : q.computedAnswer ? (
                <Note>
                  <span className="block text-xs text-muted-foreground">Running the program gives</span>
                  <pre className="whitespace-pre-wrap font-mono text-sm">{q.computedAnswer}</pre>
                </Note>
              ) : (
                <Note>The book prints no answer here, so check this one against the section cited.</Note>
              )}
              {!selfMarked && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={grade.pending} onClick={() => send(false)}>I missed it</Button>
                  <Button variant="outline" size="sm" disabled={grade.pending} onClick={() => send(true)}>I got it</Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {grade.error && (
        <ErrorNotice
          compact
          title="Not saved"
          error={grade.error}
          onRetry={last.current == null ? undefined : () => send(last.current as boolean)}
        />
      )}
      {pick != null && q.explain && <Note>{q.explain}</Note>}
      {missed && q.steps && q.steps.length > 0 && <Walk steps={q.steps} />}
    </Sheet>
  )
}
