"use client"

import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice, qk, useApi, useApiMutation } from "@/kit/data"
import { Sheet, Stepper, Tabs } from "@/kit/study"
import {
  fetchUnit,
  saveProgress,
  type LearnUnit,
  type Pack,
  type UnitProgress,
} from "@/gateways/api/packs"
import { EmptySheet, Prose, Walk, cite } from "@/surfaces/practicing/pack-shared"
import { QuestionCard } from "@/surfaces/practicing/question-card"
import { packWrites } from "@/surfaces/practicing/use-pack"

type Part = "chunk" | "steps" | "test"
const PARTS: { id: Part; label: string }[] = [
  { id: "chunk", label: "1 · Chunk" },
  { id: "steps", label: "2 · Steps" },
  { id: "test", label: "3 · Test" },
]

/** Learn walks one chapter at a time: the chunk, worked steps, then a short test. */
export function LearnTab({ pack, unitKey, setUnitKey, onChanged }: {
  pack: Pack
  unitKey: string | null
  setUnitKey: (k: string) => void
  onChanged: () => void
}) {
  const ready = pack.units.filter((u) => u.status === "ready")
  const active = unitKey ?? ready[0]?.key ?? null
  // Keyed by unit, so a slow load for the chapter you left can never land on this one.
  // A draw (the test marks its questions seen), so it is never refetched behind you.
  const unit = useApi(qk.packUnit(pack.key, active ?? ""), (signal) => fetchUnit(pack.key, active as string, signal), {
    enabled: Boolean(active),
    staleMs: Infinity,
  })

  return (
    <>
      <Stepper
        label="Chapters"
        current={active}
        onSelect={setUnitKey}
        steps={pack.units.map((u) => ({
          id: u.key,
          label: `${u.title}${u.progress.test ? " ✓" : ""}`,
          sub: u.status === "ready" ? (u.progress.test ? `${u.progress.test.good}/${u.progress.test.total}` : "ready") : u.status,
          disabled: u.status !== "ready",
        }))}
      />
      {!active ? (
        <EmptySheet>No chapter has finished building yet.</EmptySheet>
      ) : (
        <AsyncView q={unit} errorTitle="Couldn't load this chapter">
          {(u) => (
            <UnitBody
              key={active}
              pack={pack}
              unit={u}
              progress={pack.units.find((x) => x.key === active)?.progress ?? u.progress}
              onChanged={onChanged}
            />
          )}
        </AsyncView>
      )}
    </>
  )
}

function UnitBody({ pack, unit, progress, onChanged }: {
  pack: Pack
  unit: LearnUnit
  progress: UnitProgress
  onChanged: () => void
}) {
  const [part, setPart] = useState<Part>(!progress.chunk ? "chunk" : !progress.steps ? "steps" : "test")
  const [score, setScore] = useState({ good: 0, total: 0 })
  const save = useApiMutation((patch: UnitProgress) => saveProgress(pack.key, unit.key, patch), {
    invalidates: packWrites(pack.key),
    onSuccess: (_r, patch) => {
      onChanged()
      if (patch.chunk) setPart("steps")
      else if (patch.steps) setPart("test")
    },
  })
  const [lastPatch, setLastPatch] = useState<UnitProgress | null>(null)
  const send = (patch: UnitProgress) => {
    setLastPatch(patch)
    save.fire(patch)
  }

  const answered = (ok: boolean) => {
    const next = { good: score.good + (ok ? 1 : 0), total: score.total + 1 }
    setScore(next)
    if (next.total >= unit.test.length) send({ test: next })
  }

  return (
    <>
      <Tabs label="Chapter part" value={part} onChange={setPart} tabs={PARTS} />
      {save.error && (
        <ErrorNotice compact title="Not saved" error={save.error} onRetry={lastPatch ? () => send(lastPatch) : undefined} />
      )}

      {part === "chunk" && (
        <Sheet>
          <p className="text-xs text-muted-foreground">
            {unit.chunk?.source === "book_summary" ? "Compressed from the book's summary and sections." : "The book has no summary here, so this is compressed from its sections."}
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {unit.chunk?.points.map((p, i) => (
              <li key={i}>{p.text} <span className="font-mono text-micro text-muted-foreground">{cite(p.sectionKey)}</span></li>
            ))}
          </ul>
          <div><Button disabled={save.pending} onClick={() => send({ chunk: true })}>On to the steps</Button></div>
        </Sheet>
      )}

      {part === "steps" && (
        <section className="flex flex-col gap-3">
          {unit.worked.map((w) => (
            <Sheet key={w.itemKey} as="article">
              <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>{w.skillLabel}</span><span className="font-mono">{cite(w.sectionKey)}</span>
              </div>
              <Prose text={w.stem} />
              <Walk steps={w.steps ?? []} />
            </Sheet>
          ))}
          {unit.bookProblems.length > 0 && <h3 className="font-semibold">From the book</h3>}
          {unit.bookProblems.map((q) => <QuestionCard key={q.itemKey} q={q} packKey={pack.key} />)}
          <div><Button disabled={save.pending} onClick={() => send({ steps: true })}>On to the test</Button></div>
        </section>
      )}

      {part === "test" && (
        <section className="flex flex-col gap-3">
          {unit.test.length === 0 && <EmptySheet>No test questions for this chapter. The receipt on Results says why.</EmptySheet>}
          {unit.test.map((q) => <QuestionCard key={q.itemKey + q.stem} q={q} packKey={pack.key} onAnswered={answered} />)}
          {unit.test.length > 0 && <div className="font-mono text-sm tabular-nums">{score.good}/{score.total} of {unit.test.length}</div>}
        </section>
      )}
    </>
  )
}
