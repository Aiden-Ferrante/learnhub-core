"use client"

/** /styleguide sections for kit/study and kit/data: every study wrapper and every
 *  AsyncView state, with sample data. Kept apart from page.tsx to hold files small. */

import { useState } from "react"
import { Inbox } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { EmptyState } from "@/kit/patterns/empty-state"
import { AnswerGrid, Choice, Clock, Note, Sheet, Stepper, StudyPage, Tabs, Track } from "@/kit/study"
import { AsyncView, ErrorNotice, type ApiQuery } from "@/kit/data"
import { ApiError } from "@/gateways/api/http"

type Tab = "today" | "learn" | "exam" | "results"

const noop = () => {}
const SAMPLE = { items: ["Modules", "Interfaces", "Deep classes"] }
const QUERIES: { label: string; q: ApiQuery<typeof SAMPLE> }[] = [
  { label: "loading", q: { data: undefined, status: "loading", refreshing: false, error: null, retry: noop } },
  {
    label: "error",
    q: {
      data: undefined,
      status: "error",
      refreshing: false,
      error: new ApiError(503, "Service Unavailable"),
      retry: noop,
    },
  },
  { label: "empty", q: { data: { items: [] }, status: "success", refreshing: false, error: null, retry: noop } },
  { label: "data", q: { data: SAMPLE, status: "success", refreshing: false, error: null, retry: noop } },
]

export function StudyKitDemo() {
  const [tab, setTab] = useState<Tab>("learn")
  const [step, setStep] = useState("u2")
  const [pick, setPick] = useState<number | null>(1)
  const [at, setAt] = useState(2)

  return (
    <div className="overflow-hidden rounded-lg border">
      <StudyPage
        bar={
          <>
            <span className="text-title font-medium">Midterm pack</span>
            <Tabs
              label="Pack"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "today", label: "Today" },
                { id: "learn", label: "Learn" },
                { id: "exam", label: "Exam" },
                { id: "results", label: "Results" },
              ]}
            />
            <Clock seconds={1520} className="ml-auto" />
            <Clock seconds={95} low />
          </>
        }
      >
        <Sheet title="kit/study" description="StudyPage (ground + 72rem column + sticky bar), Sheet, Tabs, Clock above.">
          <Stepper
            label="Chapters"
            current={step}
            onSelect={setStep}
            steps={[
              { id: "u1", label: "1 Introduction", sub: "ready" },
              { id: "u2", label: "2 Complexity", sub: "ready" },
              { id: "u3", label: "3 Working code", sub: "building", disabled: true },
            ]}
          />
        </Sheet>

        <Sheet as="article" title="Choice" description="idle · selected · right · wrong">
          <div className="flex flex-col gap-2">
            {["A module hides complexity", "A deep module has a simple interface", "Shallow is fine"].map((c, i) => (
              <Choice key={c} index={i} state={pick === i ? "selected" : "idle"} onClick={() => setPick(i)}>
                {c}
              </Choice>
            ))}
            <Choice index={3} state="right" disabled>Marked right</Choice>
            <Choice index={4} state="wrong" disabled>Marked wrong</Choice>
          </div>
        </Sheet>

        <div className="grid gap-4 sm:grid-cols-2">
          <Sheet title="Note">
            <Note>Information: the worked solution follows the book&apos;s section 2.3.</Note>
            <Note tone="warn">This paper is 3 short: the pool ran out of unseen questions.</Note>
          </Sheet>
          <Sheet title="Track" description="low · mid · ok, picked from the value">
            <Track value={32} label="Low" />
            <Track value={64} label="Mid" />
            <Track value={91} label="Ok" />
          </Sheet>
        </div>

        <Sheet title="AnswerGrid" description="empty · answered · flagged · current · ok · no · pending">
          <AnswerGrid
            label="Questions"
            current={at}
            onSelect={setAt}
            cells={[
              { key: "1", state: "answered" },
              { key: "2", state: "answered", flagged: true },
              { key: "3" },
              { key: "4", state: "ok" },
              { key: "5", state: "no" },
              { key: "6", state: "pending" },
              { key: "7" },
              { key: "8", flagged: true },
            ]}
          />
        </Sheet>

        <Sheet title="kit/data" description="AsyncView renders one query four ways; ErrorNotice in block and compact form.">
          <div className="grid gap-4 sm:grid-cols-2">
            {QUERIES.map(({ label, q }) => (
              <div key={label} className="flex flex-col gap-1.5">
                <span className="text-micro uppercase tracking-label text-muted-foreground">{label}</span>
                <AsyncView
                  q={q}
                  errorTitle="Couldn't load your packs"
                  isEmpty={(d) => d.items.length === 0}
                  empty={<EmptyState icon={<Inbox />} title="No packs yet" description="Build one from a few chapters." />}
                >
                  {(d) => (
                    <ul className="text-body">
                      {d.items.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  )}
                </AsyncView>
              </div>
            ))}
          </div>
          <ErrorNotice compact title="Not saved" error={new ApiError(0, "Couldn't reach the server")} onRetry={noop} />
          <ErrorNotice
            compact
            error={new ApiError(422, "grade: Input should be less than or equal to 4")}
            onRetry={noop}
          />
          <div>
            <Button size="sm" variant="outline">kit/ui Button beside the study kit</Button>
          </div>
        </Sheet>
      </StudyPage>
    </div>
  )
}
