"use client"

import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice, qk, useApi, useApiMutation } from "@/kit/data"
import { Sheet } from "@/kit/study"
import { fetchSitting, startSitting, type Pack } from "@/gateways/api/packs"
import { BuildNotice, Column } from "@/surfaces/practicing/pack-shared"
import { ExamBooklet } from "@/surfaces/practicing/exam-booklet"
import { packWrites } from "@/surfaces/practicing/use-pack"

/** Exam is a timed booklet. Nothing that reveals an answer reaches this tab: the server
 *  withholds it until the paper is finished. */
export function ExamTab({ pack, sitKey, setSitKey, onClock, onFinished, onChanged }: {
  pack: Pack
  sitKey: string | null
  setSitKey: (k: string) => void
  onClock: (secondsLeft: number | null) => void
  onFinished: (key: string) => void
  onChanged: () => void
}) {
  const openKey = sitKey ?? pack.sittings.find((s) => s.status === "open")?.key ?? null
  // Answers live in the booklet's own state once loaded, so focus never refetches over them.
  const sitting = useApi(qk.sitting(openKey ?? ""), (signal) => fetchSitting(openKey as string, signal), {
    enabled: Boolean(openKey),
    staleMs: Infinity,
  })

  if (!openKey) return <StartSheet pack={pack} setSitKey={setSitKey} onChanged={onChanged} />
  return (
    <AsyncView q={sitting} errorTitle="Couldn't open your paper">
      {(sit) =>
        sit.status === "finished" ? (
          <StartSheet pack={pack} setSitKey={setSitKey} onChanged={onChanged} />
        ) : (
          <ExamBooklet key={sit.key} sit={sit} onClock={onClock} onFinished={onFinished} />
        )
      }
    </AsyncView>
  )
}

function StartSheet({ pack, setSitKey, onChanged }: { pack: Pack; setSitKey: (k: string) => void; onChanged: () => void }) {
  const fmt = pack.config.format
  const start = useApiMutation(() => startSitting(pack.key), {
    invalidates: packWrites(pack.key),
    onSuccess: (s) => {
      setSitKey(s.key)
      onChanged()
    },
  })
  return (
    <Column>
      <BuildNotice pack={pack} />
      <Sheet title={pack.sittings.some((s) => s.status === "finished") ? "Sit a fresh paper" : "Sit your first paper"}>
        <p className="text-sm text-muted-foreground">
          {fmt.count} questions · {fmt.minutes} minutes · {fmt.closedBook ? "closed book" : "open book"}. Only questions you haven&apos;t seen. Nothing is marked until you submit.
        </p>
        {start.error && <ErrorNotice compact title="Couldn't start the paper" error={start.error} onRetry={() => start.fire()} />}
        <div>
          <Button disabled={start.pending || !pack.units.some((u) => u.status === "ready")} onClick={() => start.fire()}>
            {start.pending ? "Starting…" : "Start the clock"}
          </Button>
        </div>
      </Sheet>
    </Column>
  )
}
