"use client"

import { AsyncView, qk, useApi } from "@/kit/data"
import { EmptyState } from "@/kit/patterns/empty-state"
import { ListRow } from "@/kit/patterns/list-row"
import { PageHeader } from "@/kit/patterns/page-header"
import { Sheet, StudyPage } from "@/kit/study"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { fetchPacks } from "@/gateways/api/packs"
import { PackForm } from "@/surfaces/practicing/pack-form"

/** Exam packs for one textbook: what exists, and the one setup form. Breadcrumbs are the
 *  way back to the course. The list polls while a pack is building. */
export function PacksHome({ courseTitle, docId, tree, onOpen }: {
  courseTitle: string
  docId: string
  tree: LearnTreeNode[]
  onOpen: (key: string) => void
}) {
  const packs = useApi(qk.packs(docId), (signal) => fetchPacks(docId, signal), {
    poll: (d) => (d?.packs.some((p) => p.status === "building") ? 5000 : false),
  })

  return (
    <StudyPage narrow>
      <PageHeader title="Exam packs" description={courseTitle} />
      <AsyncView
        q={packs}
        errorTitle="Couldn't load your packs"
        isEmpty={(d) => d.packs.length === 0}
        empty={<EmptyState title="No packs yet" description="Pick a few chapters below to build one." />}
      >
        {(d) => (
          <Sheet>
            <div className="flex flex-col gap-1">
              {d.packs.map((p) => (
                <ListRow
                  key={p.key}
                  title={p.title}
                  trailing={
                    <span className="font-mono tabular-nums">
                      {p.ready}/{p.units} chapters · {p.sittings} sittings{p.examDate ? ` · ${p.examDate}` : ""}
                    </span>
                  }
                  onClick={() => onOpen(p.key)}
                />
              ))}
            </div>
          </Sheet>
        )}
      </AsyncView>
      <PackForm courseTitle={courseTitle} docId={docId} tree={tree} onOpen={onOpen} />
    </StudyPage>
  )
}
