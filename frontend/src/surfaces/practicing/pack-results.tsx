"use client"

import { useMemo } from "react"
import { AsyncView, qk, useApi } from "@/kit/data"
import { Note, Sheet, Track } from "@/kit/study"
import { fetchResults, type Bucket, type Pack } from "@/gateways/api/packs"
import { EmptySheet } from "@/surfaces/practicing/pack-shared"
import { PastSittings, BuildReceipt } from "@/surfaces/practicing/pack-receipt"
import { ResultQuestion } from "@/surfaces/practicing/result-question"

const pct = (good: number, total: number) => (total ? Math.round((good / total) * 100) : 0)

function Row({ label, good, total, pending }: { label: string } & Bucket) {
  return (
    <div className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
      <span className="truncate">{label}</span>
      <Track value={pct(good, total)} label={`${label} score`} />
      <span className="text-right font-mono text-xs tabular-nums">{good}/{total}{pending ? ` +${pending}` : ""}</span>
    </div>
  )
}

/** Results marks a finished paper: the score by chapter and skill, every question with its
 *  answer, self-marks for written answers, then past sittings and the build receipt. */
export function ResultsTab({ pack, sitting, onPick, onChanged }: {
  pack: Pack
  sitting: string | null
  onPick: (k: string) => void
  onChanged: () => void
}) {
  const results = useApi(qk.sittingResults(sitting ?? ""), (signal) => fetchResults(sitting as string, signal), {
    enabled: Boolean(sitting),
  })
  const title = useMemo(() => Object.fromEntries(pack.units.map((u) => [u.key, u.title])), [pack.units])

  return (
    <>
      {!sitting ? (
        <EmptySheet>Sit a paper and your results land here.</EmptySheet>
      ) : (
        <AsyncView q={results} errorTitle="Couldn't load these results">
          {(res) => (
            <>
              <Sheet>
                <div className="flex flex-wrap items-baseline gap-x-4">
                  <span className="font-mono text-3xl font-semibold tabular-nums">{pct(res.score.good, res.score.total)}%</span>
                  <span className="text-sm text-muted-foreground">{res.score.good} of {res.score.total}</span>
                  {res.score.provisional && <span className="text-sm text-ink-warn">Provisional: {res.score.pending} written still to mark below</span>}
                </div>
                {res.shortBy > 0 && <Note tone="warn">This paper came up {res.shortBy} short: the pool ran out of unseen questions.</Note>}
                <h3 className="font-semibold">By chapter</h3>
                {Object.entries(res.score.units).map(([k, b]) => <Row key={k} {...b} label={title[k] ?? k} />)}
                <h3 className="font-semibold">By skill</h3>
                {Object.entries(res.score.skills).map(([k, b]) => <Row key={k} {...b} label={b.label ?? k} />)}
              </Sheet>
              {res.questions.map((q, i) => (
                <ResultQuestion
                  key={q.key}
                  index={i}
                  q={q}
                  sittingKey={res.key}
                  packKey={pack.key}
                  answer={res.answers[q.key] ?? {}}
                  verdict={res.score.verdicts[q.key]}
                  onMarked={onChanged}
                />
              ))}
            </>
          )}
        </AsyncView>
      )}
      <PastSittings pack={pack} onPick={onPick} />
      <BuildReceipt pack={pack} />
    </>
  )
}
