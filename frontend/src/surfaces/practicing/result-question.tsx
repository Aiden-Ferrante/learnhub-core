"use client"

import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice, qk, useApiMutation } from "@/kit/data"
import { Choice, Note, Sheet } from "@/kit/study"
import { GRADES } from "@/surfaces/studying"
import { markWritten, type SitAnswer, type SitQuestion } from "@/gateways/api/packs"
import { Prose, Walk, cite } from "@/surfaces/practicing/pack-shared"
import { packWrites } from "@/surfaces/practicing/use-pack"

/** One marked question on Results. A written answer is self-marked against the worked
 *  solution; the mark is a write, and the buttons go only once it landed. */
export function ResultQuestion({ index, q, sittingKey, packKey, answer: a, verdict: ok, onMarked }: {
  index: number
  q: SitQuestion
  sittingKey: string
  packKey: string
  answer: SitAnswer
  verdict: boolean | null | undefined
  onMarked: () => void
}) {
  const [marked, setMarked] = useState(false)
  const [lastGrade, setLastGrade] = useState<number | null>(null)
  const mark = useApiMutation((grade: number) => markWritten(sittingKey, q.key, grade), {
    invalidates: [...packWrites(packKey), qk.sittingResults(sittingKey)],
    onSuccess: () => {
      setMarked(true)
      onMarked()
    },
  })
  const send = (g: number) => {
    setLastGrade(g)
    mark.fire(g)
  }
  const choiceState = (n: number) => (n === q.answer ? "right" : a.choice === n ? "wrong" : "idle")

  return (
    <Sheet as="article">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>Question {index + 1} · {q.skillLabel}</span>
        <span className="font-mono">{ok == null ? "to mark" : ok ? "right" : "missed"} · {cite(q.sectionKey)}</span>
      </div>
      <Prose text={q.stem} />
      {q.qtype === "choice" ? (
        <div className="flex flex-col gap-2">
          {q.choices?.map((c, n) => (
            <Choice key={n} index={n} state={choiceState(n)} disabled>
              <span className="whitespace-pre-wrap">{c}</span>
            </Choice>
          ))}
          {a.choice != null && q.why?.[String(a.choice)] && <Note tone="warn">Likely mistake: {q.why[String(a.choice)]}</Note>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="whitespace-pre-wrap rounded-md border p-2 text-sm">{a.response || "No answer written."}</div>
          <Note>
            <div className="whitespace-pre-wrap">{String(q.answer ?? "")}</div>
            {q.rubric && <div className="mt-1 text-xs text-muted-foreground">{q.rubric}</div>}
          </Note>
          {a.selfGrade == null && !marked && (
            <div className="flex flex-wrap gap-2">
              {GRADES.map((g) => (
                <Button key={g.grade} variant="outline" size="sm" disabled={mark.pending} onClick={() => send(g.grade)}>
                  {g.label}
                </Button>
              ))}
            </div>
          )}
          {mark.error && (
            <ErrorNotice compact title="Not saved" error={mark.error} onRetry={lastGrade == null ? undefined : () => send(lastGrade)} />
          )}
        </div>
      )}
      {q.explain && <Note>{q.explain}</Note>}
      {ok === false && q.steps && q.steps.length > 0 && <Walk steps={q.steps} />}
    </Sheet>
  )
}
