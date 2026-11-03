"use client"

import { useCallback, useState } from "react"
import { AsyncView } from "@/kit/data"
import { Clock, StudyPage, Tabs } from "@/kit/study"
import type { Pack, PlanStep } from "@/gateways/api/packs"
import { TodayTab } from "@/surfaces/practicing/pack-today"
import { LearnTab } from "@/surfaces/practicing/pack-learn"
import { ExamTab } from "@/surfaces/practicing/pack-exam"
import { ResultsTab } from "@/surfaces/practicing/pack-results"
import { usePack } from "@/surfaces/practicing/use-pack"
import { Column } from "@/surfaces/practicing/pack-shared"

/** One exam pack. Today says what to do now, Learn walks one chapter at a time, Exam is a
 *  timed booklet, Results marks it. The tab lives in the URL (`?tab=`, docs/ui-spec.md §2);
 *  the page owns it and passes it in. Breadcrumbs are the way back to the pack list. */

export type PackTab = "today" | "learn" | "exam" | "results"
export const PACK_TABS: { id: PackTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "learn", label: "Learn" },
  { id: "exam", label: "Exam" },
  { id: "results", label: "Results" },
]

/** `?tab=` → a tab; anything else is Today. */
export function parsePackTab(v: string | null | undefined): PackTab {
  return PACK_TABS.some((t) => t.id === v) ? (v as PackTab) : "today"
}

export function PackView({ packKey, tab, onTab }: { packKey: string; tab: PackTab; onTab: (t: PackTab) => void }) {
  const pack = usePack(packKey)
  const [clock, setClock] = useState<number | null>(null)
  const onClock = useCallback((s: number | null) => setClock(s), [])

  return (
    <StudyPage
      bar={
        <>
          <span className="mr-auto min-w-0 truncate text-title font-medium">{pack.data?.title ?? "Exam pack"}</span>
          <Tabs label="Pack" value={tab} onChange={onTab} tabs={PACK_TABS} />
          {clock != null && tab === "exam" && <Clock seconds={clock} low={clock < 300} />}
        </>
      }
    >
      <AsyncView q={pack} errorTitle="Couldn't load this pack">
        {(p) => <PackBody pack={p} tab={tab} onTab={onTab} onClock={onClock} onChanged={pack.retry} />}
      </AsyncView>
    </StudyPage>
  )
}

/** The tab bodies. Unit, open sitting and shown result are kept here, so they survive a
 *  tab switch (but not a reload: only the tab is in the URL). */
function PackBody({ pack, tab, onTab, onClock, onChanged }: {
  pack: Pack
  tab: PackTab
  onTab: (t: PackTab) => void
  onClock: (s: number | null) => void
  onChanged: () => void
}) {
  const [unitKey, setUnitKey] = useState<string | null>(null)
  const [sitKey, setSitKey] = useState<string | null>(null)
  const [resultKey, setResultKey] = useState<string | null>(null)
  const lastFinished = pack.sittings.find((s) => s.status === "finished")?.key ?? null

  const go = (step: PlanStep) => {
    if (step.kind === "learn") {
      setUnitKey(step.unitKey)
      onTab("learn")
    } else if (step.kind === "exam") onTab("exam")
    else if (step.kind === "weak") onTab("results")
  }

  const finished = useCallback(
    (key: string) => {
      setSitKey(null)
      setResultKey(key)
      onChanged()
      onTab("results")
    },
    [onChanged, onTab],
  )

  if (tab === "exam")
    return (
      <ExamTab pack={pack} sitKey={sitKey} setSitKey={setSitKey} onClock={onClock} onFinished={finished} onChanged={onChanged} />
    )
  return (
    <Column>
      {tab === "today" && <TodayTab pack={pack} onGo={go} onChanged={onChanged} />}
      {tab === "learn" && <LearnTab pack={pack} unitKey={unitKey} setUnitKey={setUnitKey} onChanged={onChanged} />}
      {tab === "results" && (
        <ResultsTab pack={pack} sitting={resultKey ?? lastFinished} onPick={setResultKey} onChanged={onChanged} />
      )}
    </Column>
  )
}
