"use client"

import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data"
import { ListRow } from "@/kit/patterns/list-row"
import { Note, Sheet } from "@/kit/study"
import type { Pack } from "@/gateways/api/packs"
import { useSaveScopeNotes } from "@/surfaces/practicing/use-pack"

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

/** The pack's scope notes, editable after the build. Saving reweights each skill (one model
 *  call per chapter, no new questions), and the next paper draws by the new weights. */
export function ScopeNotes({ pack }: { pack: Pack }) {
  const current = pack.config?.scopeNotes ?? ""
  const [notes, setNotes] = useState(current)
  const save = useSaveScopeNotes(pack.key)
  const running = pack.status === "building"
  const last = pack.receipt?.reweight
  return (
    <Sheet title="Scope notes">
      <p className="text-meta text-muted-foreground">
        What the exam stresses or skips. Notes change how often each skill comes up on a paper;
        they can&apos;t add material the book doesn&apos;t have.
      </p>
      <textarea className="study-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="e.g. Heavy on exceptions and list slicing; no file I/O." aria-label="Scope notes" />
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={running || save.pending || notes.trim() === current.trim()}
          onClick={() => save.fire(notes)}>
          {running ? "Reweighting…" : "Save and reweight"}
        </Button>
        {save.error && <ErrorNotice compact title="Not saved" error={save.error} />}
      </div>
      {!running && last && (
        <Note>
          {last.changes.length === 0
            ? "The last reweight left every skill at its weight."
            : `The last reweight changed ${last.changes.length} skill${last.changes.length === 1 ? "" : "s"}.`}
          {last.changes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {last.changes.slice(0, 12).map((c, i) => (
                <li key={i}>{c.skill}: {c.from} → {c.to}{c.reason ? ` (${c.reason})` : ""}</li>
              ))}
              {last.changes.length > 12 && <li>and {last.changes.length - 12} more</li>}
            </ul>
          )}
          {last.failed.length > 0 && <div className="text-xs">Failed: {last.failed.map((f) => f.title).join(", ")}</div>}
        </Note>
      )}
    </Sheet>
  )
}
