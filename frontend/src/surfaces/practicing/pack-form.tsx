"use client"

import type React from "react"
import { useMemo, useState } from "react"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice, qk, roots, useApi, useApiMutation } from "@/kit/data"
import { Sheet } from "@/kit/study"
import { displaySectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { createPack, fetchPresets, savePreset, type PackFormat } from "@/gateways/api/packs"

/** The one setup form: pick chapters, set the format, optionally add scope notes that
 *  weight questions but never add material. */

const FALLBACK: PackFormat = { count: 20, minutes: 40, choices: 5, writtenShare: 0.2, closedBook: true }

/** Chapters worth offering: top-level nodes, or their children where a module groups them. */
function chapterOptions(tree: LearnTreeNode[]): LearnTreeNode[] {
  return tree.flatMap((n) => {
    const kids = n.children.filter((c) => c.sectionKey && c.children.length > 0)
    return kids.length > 0 ? kids : n.sectionKey ? [n] : []
  })
}

export function PackForm({ courseTitle, docId, tree, onOpen }: {
  courseTitle: string
  docId: string
  tree: LearnTreeNode[]
  onOpen: (key: string) => void
}) {
  const presets = useApi(qk.packPresets(docId), (signal) => fetchPresets(docId, signal))
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState("")
  // null until edited: the saved preset (or the server default) fills the form meanwhile.
  const [edited, setFormat] = useState<PackFormat | null>(null)
  const format = edited ?? presets.data?.presets[0]?.format ?? presets.data?.default ?? FALLBACK
  const [notes, setNotes] = useState("")
  const [examDate, setExamDate] = useState("")

  const options = useMemo(() => chapterOptions(tree), [tree])
  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  const create = useApiMutation(
    () =>
      createPack({
        doc: docId,
        title: title || `${courseTitle} exam`,
        chapters: options
          .filter((o) => picked.includes(o.sectionKey as string))
          .map((o) => ({ scope: o.sectionKey as string, title: displaySectionTitle(o.label, o.title) })),
        format,
        scopeNotes: notes,
        examDate: examDate || null,
      }),
    { invalidates: [roots.packs], onSuccess: ({ key }) => onOpen(key) },
  )
  const preset = useApiMutation((f: PackFormat) => savePreset(docId, "Default", f), {
    invalidates: [qk.packPresets(docId)],
  })

  return (
    <Sheet title="New pack">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Chapters</span>
        <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
          {options.map((o) => (
            <label key={o.sectionKey} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(o.sectionKey as string)}
                onChange={() => toggle(o.sectionKey as string)}
              />
              <span className="truncate">{displaySectionTitle(o.label, o.title)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pack name">
          <input className="study-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${courseTitle} exam`} />
        </Field>
        <Field label="Exam date (optional)">
          <input className="study-input" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        </Field>
        <Field label="Questions">
          <input className="study-input" type="number" min={1} max={100} value={format.count}
            onChange={(e) => setFormat({ ...format, count: Number(e.target.value) })} />
        </Field>
        <Field label="Minutes">
          <input className="study-input" type="number" min={1} max={300} value={format.minutes}
            onChange={(e) => setFormat({ ...format, minutes: Number(e.target.value) })} />
        </Field>
        <Field label="Choices per question">
          <select className="study-input" value={format.choices}
            onChange={(e) => setFormat({ ...format, choices: Number(e.target.value) === 4 ? 4 : 5 })}>
            <option value={5}>5</option>
            <option value={4}>4</option>
          </select>
        </Field>
        <Field label={`Written share: ${Math.round(format.writtenShare * 100)}%`}>
          <input className="w-full" type="range" min={0} max={1} step={0.05} value={format.writtenShare}
            onChange={(e) => setFormat({ ...format, writtenShare: Number(e.target.value) })} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={format.closedBook}
          onChange={(e) => setFormat({ ...format, closedBook: e.target.checked })} />
        Closed book
      </label>

      <Field label="Scope notes (optional). These weight questions; they can't add material the book doesn't have.">
        <textarea className="study-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {create.error && <ErrorNotice compact title="Couldn't start the build" error={create.error} onRetry={() => create.fire()} />}
      {preset.error && <ErrorNotice compact title="Preset not saved" error={preset.error} onRetry={() => preset.fire(format)} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={create.pending || picked.length === 0} onClick={() => create.fire()}>
          {create.pending ? "Starting…" : `Build pack from ${picked.length} chapter${picked.length === 1 ? "" : "s"}`}
        </Button>
        <Button variant="outline" size="sm" disabled={preset.pending} onClick={() => preset.fire(format)}>
          Save format as preset
        </Button>
        <AsyncView q={presets} error="inline" errorTitle="Couldn't load your presets" skeleton={<></>}>
          {(d) =>
            d.presets.map((p) => (
              <Button key={p.name} variant="ghost" size="sm" onClick={() => setFormat(p.format)}>
                Use {p.name}
              </Button>
            ))
          }
        </AsyncView>
      </div>
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
