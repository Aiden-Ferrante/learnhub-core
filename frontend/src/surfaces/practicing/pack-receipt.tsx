"use client"

import { ListRow } from "@/kit/patterns/list-row"
import { Sheet } from "@/kit/study"
import type { Pack } from "@/gateways/api/packs"

/** Every finished sitting of this pack; picking one shows its results. */
export function PastSittings({ pack, onPick }: { pack: Pack; onPick: (k: string) => void }) {
  const finished = pack.sittings.filter((s) => s.status === "finished")
  if (finished.length === 0) return null
  return (
    <Sheet title="Past sittings">
      <div className="flex flex-col gap-1">
        {finished.map((s) => (
          <ListRow
            key={s.key}
            title={new Date(s.startedAt * 1000).toLocaleString()}
            trailing={<span className="font-mono tabular-nums">{s.questions} questions</span>}
            onClick={() => onPick(s.key)}
          />
        ))}
      </div>
    </Sheet>
  )
}

/** What the build kept and dropped for each chapter, and why. */
export function BuildReceipt({ pack }: { pack: Pack }) {
  return (
    <Sheet title="Build receipt">
      {pack.units.map((u) => (
        <details key={u.key} className="text-sm">
          <summary className="cursor-pointer">
            {u.title}: {u.status === "ready" ? `${u.receipt?.kept ?? 0} kept, ${u.receipt?.droppedCount ?? 0} dropped` : u.status}
            {u.receipt?.thin ? ` · thin (${u.receipt.capacity} unseen for a share of ${u.receipt.share})` : ""}
          </summary>
          <div className="mt-1 text-xs text-muted-foreground">
            {u.receipt?.source === "book_summary" ? "Used the book's summary" : "No book summary"} · {u.receipt?.bookProblems ?? 0} book problems · {u.receipt?.skills ?? 0} skills
            {u.receipt?.error && <div>{u.receipt.error}</div>}
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
            {u.receipt?.dropped?.map((d, i) => <li key={i}>{d.kind}: {d.what} ({d.reason})</li>)}
          </ul>
        </details>
      ))}
    </Sheet>
  )
}
