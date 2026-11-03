"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data"
import { AnswerGrid, Choice, Note, Sheet } from "@/kit/study"
import type { SitAnswer, Sitting } from "@/gateways/api/packs"
import { Prose, cite } from "@/surfaces/practicing/pack-shared"
import { useSitting } from "@/surfaces/practicing/use-sitting"

const isAnswered = (a?: SitAnswer) => a != null && (a.choice != null || Boolean(a.response))

/** One open paper: the question on the left, the answer sheet on the right. The clock
 *  submits at 0:00, once; if that submit fails, the error and Submit stay live. */
export function ExamBooklet({ sit, onClock, onFinished }: {
  sit: Sitting
  onClock: (secondsLeft: number | null) => void
  onFinished: (key: string) => void
}) {
  const s = useSitting(sit, onFinished)
  const [at, setAt] = useState(0)
  const [confirming, setConfirming] = useState(false)

  const submitRef = useRef(s.submit)
  submitRef.current = s.submit
  const autoSubmitted = useRef(false)
  const { startedAt, minutes } = sit
  useEffect(() => {
    if (!startedAt || !minutes) return
    const end = startedAt + minutes * 60
    const tick = () => {
      const left = Math.max(0, Math.round(end - Date.now() / 1000))
      onClock(left)
      if (left === 0 && !autoSubmitted.current) {
        autoSubmitted.current = true
        submitRef.current()
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => {
      clearInterval(t)
      onClock(null)
    }
  }, [startedAt, minutes, onClock])

  const go = (i: number) => {
    s.flush()
    setAt(i)
  }
  const q = sit.questions[at]
  const a: SitAnswer = s.answers[q.key] ?? {}
  const answered = sit.questions.filter((x) => isAnswered(s.answers[x.key])).length

  return (
    <div className="study-booklet">
      <Sheet>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-semibold">Question {at + 1}</span>
          <span className="text-xs text-muted-foreground">{q.skillLabel} · {cite(q.sectionKey)}</span>
        </div>
        <Prose text={q.stem} />
        {q.qtype === "choice" ? (
          <div className="flex flex-col gap-2">
            {q.choices?.map((c, i) => (
              <Choice key={i} index={i} state={a.choice === i ? "selected" : "idle"} onClick={() => s.update(q.key, { choice: i })}>
                <span className="whitespace-pre-wrap">{c}</span>
              </Choice>
            ))}
          </div>
        ) : (
          <textarea
            className="study-input"
            rows={7}
            aria-label={`Answer to question ${at + 1}`}
            value={a.response ?? ""}
            onChange={(e) => s.update(q.key, { response: e.target.value }, true)}
            onBlur={s.flush}
            placeholder="Write your answer. You'll mark it against the worked solution on Results."
          />
        )}
        {s.unsaved > 0 && (
          <ErrorNotice
            compact
            title={`Not saved (${s.unsaved} answer${s.unsaved === 1 ? "" : "s"})`}
            error={s.saveError}
            onRetry={s.retryUnsaved}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={at === 0} onClick={() => go(at - 1)}>Previous</Button>
          <Button variant="outline" size="sm" onClick={() => s.update(q.key, { flag: !a.flag })}>{a.flag ? "Unflag" : "Flag"}</Button>
          <span className="flex-1" />
          <Button size="sm" disabled={at === sit.questions.length - 1} onClick={() => go(at + 1)}>Next</Button>
        </div>
      </Sheet>
      <Sheet as="aside">
        <span className="text-xs font-medium text-muted-foreground">Answer sheet · {answered}/{sit.questions.length}</span>
        <AnswerGrid
          label="Questions"
          current={at}
          onSelect={go}
          cells={sit.questions.map((x) => ({
            key: x.key,
            state: isAnswered(s.answers[x.key]) ? "answered" : "empty",
            flagged: Boolean(s.answers[x.key]?.flag),
          }))}
        />
        {sit.shortBy > 0 && <Note tone="warn">This paper is {sit.shortBy} short: the pool ran out of unseen questions.</Note>}
        {s.finishError && (
          <ErrorNotice compact title="Not submitted" error={s.finishError} onRetry={s.submit} />
        )}
        {!confirming ? (
          <Button disabled={s.finishing} onClick={() => setConfirming(true)}>Submit paper</Button>
        ) : (
          <Note tone="warn" className="flex flex-col gap-2">
            <span>{sit.questions.length - answered} unanswered. Submit now?</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={s.finishing} onClick={s.submit}>{s.finishing ? "Submitting…" : "Submit"}</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Keep going</Button>
            </div>
          </Note>
        )}
      </Sheet>
    </div>
  )
}
