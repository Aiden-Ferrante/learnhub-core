"use client"

import { useEffect, useState } from "react"
import { Button } from "@/kit/ui/button"
import { Input } from "@/kit/ui/input"
import { Label } from "@/kit/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/kit/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/kit/ui/select"
import { ErrorNotice, roots, useApiMutation, unwrap } from "@/kit/data"
import { saveManualSession, type ManualSessionInput, type WorkingSession } from "@/gateways/api/planner"

// Local-time form helpers.
const toLocalDate = (sec: number) => {
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const toLocalTime = (sec: number) => {
  const d = new Date(sec * 1000)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** Log/edit a manual study-time block: course, local date + start time, duration, note.
 *  Duration (not end time) keeps "end before start" unrepresentable in the form; the
 *  backend still validates. Saving is a mutation: the dialog closes only once the block
 *  is stored, and a failure stays in the dialog with a Retry. */
export function ManualSessionDialog({
  open,
  editing,
  courses,
  onClose,
}: {
  open: boolean
  editing: WorkingSession | null
  courses: { doc: string; title: string }[]
  onClose: () => void
}) {
  const [doc, setDoc] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [minutes, setMinutes] = useState("30")
  const [note, setNote] = useState("")
  const [invalid, setInvalid] = useState<string | null>(null)
  const [last, setLast] = useState<ManualSessionInput | null>(null)

  const save = useApiMutation((input: ManualSessionInput) => unwrap(saveManualSession(input)), {
    invalidates: [roots.sessions, roots.activity],
    onSuccess: () => onClose(),
  })
  const { reset } = save

  // Re-seed the form each open: edit prefills from the block, add defaults to "the last
  // half hour, first course".
  useEffect(() => {
    if (!open) return
    setInvalid(null)
    reset()
    if (editing) {
      setDoc(editing.courses[0]?.doc ?? "")
      setDate(toLocalDate(editing.start))
      setTime(toLocalTime(editing.start))
      setMinutes(String(Math.max(1, Math.round(editing.durationMin))))
      setNote(editing.note ?? "")
    } else {
      const nowSec = Date.now() / 1000
      setDoc(courses[0]?.doc ?? "")
      setDate(toLocalDate(nowSec))
      setTime(toLocalTime(nowSec - 1800))
      setMinutes("30")
      setNote("")
    }
  }, [open, editing, courses, reset])

  const submit = () => {
    const start = new Date(`${date}T${time}`).getTime() / 1000
    const mins = parseInt(minutes, 10)
    if (!doc || !Number.isFinite(start) || !Number.isFinite(mins) || mins <= 0) {
      setInvalid("Pick a course, a valid start, and a positive duration.")
      return
    }
    setInvalid(null)
    const input = { doc, start, end: start + mins * 60, note: note.trim() || null, key: editing?.key }
    setLast(input)
    save.fire(input)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit study time" : "Log study time"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Course</Label>
            <Select value={doc} onValueChange={setDoc}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a course" />
              </SelectTrigger>
              <SelectContent>
                {courses.map((c) => (
                  <SelectItem key={c.doc} value={c.doc}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-date">Date</Label>
              <Input id="ms-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-time">Start</Label>
              <Input id="ms-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-minutes">Duration (minutes)</Label>
            <Input
              id="ms-minutes"
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-note">Note (optional)</Label>
            <Input id="ms-note" value={note} placeholder="e.g. chapter 3 on paper" onChange={(e) => setNote(e.target.value)} />
          </div>
          {invalid && <p className="text-sm text-ink-danger">{invalid}</p>}
          {save.error && (
            <ErrorNotice compact title="Not saved" error={save.error} onRetry={() => last && save.fire(last)} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.pending}>
            {editing ? "Save changes" : "Log time"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
