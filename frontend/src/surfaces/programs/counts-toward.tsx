"use client"

/** Level 4 · Course (canvas board "L4-Course", 2026-11-21): the course page stays as it is,
 *  plus one strip — the programs and tracks this course counts toward, and "+ Add to a
 *  program". */

import Link from "next/link"
import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/kit/ui/dialog"
import { Label } from "@/kit/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/kit/ui/select"
import { addCourses, cr, creditsOf, placements, removeCourse, trackProgress } from "@/surfaces/programs/programs"
import { useProgramCourses, usePrograms } from "@/surfaces/programs/use-programs"

export function CountsToward({ courseId }: { courseId: string }) {
  const programs = usePrograms()
  const courses = useProgramCourses()
  const [open, setOpen] = useState(false)
  if (!programs.ready) return null
  const s = programs.state
  const here = placements(s, courseId)
  const credits = creditsOf(s, courseId)

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-meta">
      <span className="mr-1 text-micro uppercase tracking-label text-muted-foreground">Counts toward</span>
      {here.length === 0 && <span className="text-muted-foreground">No program yet</span>}
      {here.map(({ program, track }) => {
        const p = trackProgress(s, track, courses.studied)
        return (
          <span key={track.id} className="group flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-3 pr-1">
            <Link href={`/programs/${program.id}/tracks/${track.id}`} className="hover:underline">
              {program.name} <span className="text-muted-foreground">›</span> {track.name}
            </Link>
            <span className="tabular-nums text-muted-foreground">
              · {cr(credits)} cr · track {cr(p.earned)}/{cr(p.required)}
            </span>
            <button
              type="button"
              aria-label={`Take this course out of ${program.name} › ${track.name}`}
              onClick={() => programs.update((x) => removeCourse(x, program.id, track.id, courseId))}
              className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}
      <button type="button" onClick={() => setOpen(true)} className="ml-1 font-medium text-brand hover:underline">
        + Add to a program
      </button>
      <AddToProgramDialog
        open={open}
        state={s}
        courseId={courseId}
        onClose={() => setOpen(false)}
        onSubmit={(pid, tid) => {
          programs.update((x) => addCourses(x, pid, tid, [courseId]))
          setOpen(false)
        }}
      />
    </div>
  )
}

function AddToProgramDialog({
  open,
  state,
  courseId,
  onClose,
  onSubmit,
}: {
  open: boolean
  state: ReturnType<typeof usePrograms>["state"]
  courseId: string
  onClose: () => void
  onSubmit: (programId: string, trackId: string) => void
}) {
  const options = state.programs.flatMap((p) =>
    p.tracks.filter((t) => !t.courseIds.includes(courseId)).map((t) => ({ value: `${p.id}|${t.id}`, label: `${p.name} › ${t.name}` })),
  )
  const [value, setValue] = useState("")
  const picked = options.some((o) => o.value === value) ? value : (options[0]?.value ?? "")
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to a program</DialogTitle>
          <DialogDescription>Pick the track this course counts toward. It can count toward several.</DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            {state.programs.length === 0 ? "You have no programs yet. " : "This course is already in every track. "}
            <Link href="/courses" className="font-medium text-brand hover:underline">
              {state.programs.length === 0 ? "Create one in the Library" : "Add a track in a program"}
            </Link>
            {state.programs.some((p) => p.tracks.length === 0) && " (a program needs a track first)"}.
          </p>
        ) : (
          <div className="space-y-1.5 py-2">
            <Label>Program › track</Label>
            <Select value={picked} onValueChange={setValue}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!picked}
            onClick={() => {
              const [pid, tid] = picked.split("|")
              onSubmit(pid, tid)
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
