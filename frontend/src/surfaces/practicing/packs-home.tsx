"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/kit/ui/button"
import { displaySectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import {
  createPack,
  fetchPacks,
  fetchPresets,
  savePreset,
  type PackFormat,
  type PackSummary,
} from "@/gateways/api/packs"

/** Exam packs for one textbook: what exists, and the one setup form. Pick chapters, set the
 *  format, optionally add scope notes that weight questions but never add material. */

const FALLBACK: PackFormat = { count: 20, minutes: 40, choices: 5, writtenShare: 0.2, closedBook: true }

/** Chapters worth offering: top-level nodes, or their children where a module groups them. */
function chapterOptions(tree: LearnTreeNode[]): LearnTreeNode[] {
  return tree.flatMap((n) => {
    const kids = n.children.filter((c) => c.sectionKey && c.children.length > 0)
    return kids.length > 0 ? kids : n.sectionKey ? [n] : []
  })
}

export function PacksHome({
  courseTitle,
  docId,
  tree,
  onOpen,
  onBack,
}: {
  courseTitle: string
  docId: string
  tree: LearnTreeNode[]
  onOpen: (key: string) => void
  onBack: () => void
}) {
  const [packs, setPacks] = useState<PackSummary[] | null>(null)
  const [presets, setPresets] = useState<{ name: string; format: PackFormat }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState("")
  const [format, setFormat] = useState<PackFormat>(FALLBACK)
  const [notes, setNotes] = useState("")
  const [examDate, setExamDate] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchPacks(docId).then((r) => setPacks(r.packs)).catch((e) => setError(String(e.message ?? e)))
    fetchPresets(docId)
      .then((r) => {
        setPresets(r.presets)
        setFormat(r.presets[0]?.format ?? r.default)
      })
      .catch(() => undefined)
  }, [docId])

  const options = useMemo(() => chapterOptions(tree), [tree])
  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  async function build() {
    setBusy(true)
    setError(null)
    try {
      const chapters = options
        .filter((o) => picked.includes(o.sectionKey as string))
        .map((o) => ({ scope: o.sectionKey as string, title: displaySectionTitle(o.label, o.title) }))
      const { key } = await createPack({
        doc: docId,
        title: title || `${courseTitle} exam`,
        chapters,
        format,
        scopeNotes: notes,
        examDate: examDate || null,
      })
      onOpen(key)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="study-page">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Exam packs</h1>
            <p className="text-sm text-muted-foreground">{courseTitle}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onBack}>
            Back to course
          </Button>
        </div>

        {error && <div className="study-note warn text-sm">{error}</div>}

        {packs && packs.length > 0 && (
          <section className="study-sheet flex flex-col gap-2">
            {packs.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onOpen(p.key)}
                className="flex items-baseline justify-between gap-3 rounded-md p-2 text-left hover:bg-muted"
              >
                <span className="font-medium">{p.title}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {p.ready}/{p.units} chapters · {p.sittings} sittings
                  {p.examDate ? ` · ${p.examDate}` : ""}
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="study-sheet flex flex-col gap-4">
          <h2 className="font-semibold">New pack</h2>

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

          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || picked.length === 0} onClick={build}>
              {busy ? "Starting…" : `Build pack from ${picked.length} chapter${picked.length === 1 ? "" : "s"}`}
            </Button>
            <Button variant="outline" size="sm" onClick={() => savePreset(docId, "Default", format).then(() => setPresets([{ name: "Default", format }]))}>
              Save format as preset
            </Button>
            {presets.map((p) => (
              <Button key={p.name} variant="ghost" size="sm" onClick={() => setFormat(p.format)}>
                Use {p.name}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
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
