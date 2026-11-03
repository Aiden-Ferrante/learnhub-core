"use client"

import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { AsyncView, qk, useApi } from "@/kit/data"
import { ListRow } from "@/kit/patterns/list-row"
import { Sheet } from "@/kit/study"
import { fetchReviewSet, fetchToday, type Pack, type PlanStep } from "@/gateways/api/packs"
import { BuildNotice, EmptySheet } from "@/surfaces/practicing/pack-shared"
import { QuestionCard } from "@/surfaces/practicing/question-card"

const minutes = (m: number | null) =>
  m != null ? <span className="font-mono tabular-nums">{m} min</span> : undefined

/** What to do now, then what comes after. A review step draws its questions here. */
export function TodayTab({ pack, onGo, onChanged }: { pack: Pack; onGo: (s: PlanStep) => void; onChanged: () => void }) {
  const today = useApi(qk.packToday(pack.key), (signal) => fetchToday(pack.key, signal))
  const [reviewing, setReviewing] = useState(false)
  // A draw: each GET marks questions seen, so it is read once and never refetched.
  const review = useApi(qk.packReviewSet(pack.key), (signal) => fetchReviewSet(pack.key, signal), {
    enabled: reviewing,
    staleMs: Infinity,
  })

  return (
    <>
      <BuildNotice pack={pack} />
      <AsyncView q={today} errorTitle="Couldn't load today's plan">
        {(t) => (
          <>
            {t.now ? (
              <Sheet>
                <span className="text-xs font-medium text-muted-foreground">Do this now</span>
                <h2 className="text-lg font-semibold">{t.now.title}</h2>
                {t.now.minutes != null && <span className="text-xs text-muted-foreground">{minutes(t.now.minutes)}</span>}
                <div>
                  <Button onClick={() => (t.now?.kind === "review" ? setReviewing(true) : t.now && onGo(t.now))}>Start</Button>
                </div>
              </Sheet>
            ) : (
              <EmptySheet>Nothing is ready yet. Finished chapters appear here as they build.</EmptySheet>
            )}
            {reviewing && (
              <AsyncView
                q={review}
                errorTitle="Couldn't draw your review questions"
                isEmpty={(r) => r.questions.length === 0}
                empty={<EmptySheet>No questions could be drawn for your due skills.</EmptySheet>}
              >
                {(r) => (
                  <section className="flex flex-col gap-3">
                    {r.questions.map((q) => (
                      <QuestionCard key={q.itemKey + q.stem} q={q} packKey={pack.key} onAnswered={onChanged} />
                    ))}
                  </section>
                )}
              </AsyncView>
            )}
            {t.next.length > 0 && (
              <Sheet>
                <span className="text-xs font-medium text-muted-foreground">
                  Then{t.examDate ? ` · exam ${t.examDate}` : ""}
                </span>
                <div className="flex flex-col gap-1">
                  {t.next.map((s, i) => (
                    <ListRow key={i} title={s.title} trailing={minutes(s.minutes)} onClick={() => onGo(s)} />
                  ))}
                </div>
              </Sheet>
            )}
          </>
        )}
      </AsyncView>
    </>
  )
}
