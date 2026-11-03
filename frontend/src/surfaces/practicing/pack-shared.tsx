"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { Note, Sheet } from "@/kit/study"
import { MarkdownReader } from "@/surfaces/reading"
import type { Pack, Step } from "@/gateways/api/packs"

/** Small pieces every pack tab shares: the prose renderer, the section citation, the
 *  build notice and the step-by-step walk. */

export const cite = (key: string) => `§ ${key.replace(/^toc:/, "")}`

export function Prose({ text }: { text: string }) {
  return <MarkdownReader content={text} proseSize="sm" className="mx-0 max-w-none text-left" />
}

/** "3 of 5 chapters ready", plus why any chapter failed. Hidden once every chapter built. */
export function BuildNotice({ pack }: { pack: Pack }) {
  const ready = pack.units.filter((u) => u.status === "ready").length
  const failed = pack.units.filter((u) => u.status === "failed")
  if (ready === pack.units.length) return null
  return (
    <Note tone={failed.length > 0 ? "warn" : "info"}>
      {ready} of {pack.units.length} chapters ready. Finished chapters open now.
      {failed.map((u) => (
        <div key={u.key}>{u.title} failed: {u.receipt?.error}</div>
      ))}
    </Note>
  )
}

/** Reveal one step at a time: the Exam Generator's Learn mode. */
export function Walk({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(0)
  return (
    <ol className="flex flex-col gap-2">
      {steps.slice(0, open + 1).map((s, i) => (
        <li key={i} className="rounded-md border p-2 text-sm">
          <div className="font-medium">Step {i + 1}. {s.ask}</div>
          {i < open && s.show && <div className="mt-1 whitespace-pre-wrap font-mono text-xs text-ink-accent">{s.show}</div>}
        </li>
      ))}
      <li>
        {open < steps.length ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(open + 1)}>Reveal step</Button>
        ) : (
          <span className="text-xs text-muted-foreground">All steps shown.</span>
        )}
      </li>
    </ol>
  )
}

/** A plain one-line empty message inside a sheet (a tab with nothing to show yet). */
export function EmptySheet({ children }: { children: React.ReactNode }) {
  return (
    <Sheet>
      <p className="text-sm text-muted-foreground">{children}</p>
    </Sheet>
  )
}

/** The 48rem reading column inside a pack page, for everything but the exam booklet. */
export function Column({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">{children}</div>
}
