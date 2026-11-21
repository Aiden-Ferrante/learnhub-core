"use client"

/** Pieces the program screens share: the credits bar, the course card used in track shelves,
 *  and the dialogs that create and edit programs and tracks and add courses to a track. */

import Link from "next/link"
import { useState } from "react"
import { Check, Search } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/kit/ui/dialog"
import { Input } from "@/kit/ui/input"
import { Label } from "@/kit/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/kit/ui/select"
import { cn } from "@/kit/lib/utils"
import { CourseCover } from "@/surfaces/library/course-card"
import { COURSE_COLORS, coverColor } from "@/surfaces/library/cover"
import type { Course } from "@/surfaces/library/courses"
import { statusOf, type TrackRule } from "@/surfaces/programs/programs"

/** A track's colour: by its place in the program, from the course palette. */
export const trackColor = (i: number) => COURSE_COLORS[i % COURSE_COLORS.length]

export function Bar({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: color }} />
    </div>
  )
}

/** One bar for a program, a segment per track sized by its required credits, filled by what is earned. */
export function SegmentedBar({ parts, className }: { parts: { earned: number; required: number; color: string }[]; className?: string }) {
  const total = parts.reduce((a, p) => a + p.required, 0)
  if (total <= 0) return <div className={cn("h-2 rounded-full bg-muted", className)} />
  return (
    <div className={cn("flex h-2 gap-0.5", className)}>
      {parts.map((p, i) => (
        <div key={i} className="h-full overflow-hidden rounded-full bg-muted" style={{ width: `${(p.required / total) * 100}%` }}>
          <div className="h-full" style={{ width: `${p.required ? (p.earned / p.required) * 100 : 0}%`, background: p.color }} />
        </div>
      ))}
    </div>
  )
}

export function StatusText({ studied }: { studied: number }) {
  const s = statusOf(studied)
  if (s === "done") return <span className="text-ink-ok">✓ Done</span>
  if (s === "going") return <span>{Math.round(studied * 100)}% studied</span>
  return <span>Not started</span>
}

/** A course in a track shelf: today's cover card, smaller, with where else it counts. */
export function ProgramCourseCard({ course, studied, also }: { course: Course; studied: number; also: string[] }) {
  const color = coverColor(course.title)
  return (
    <article className="group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-colors hover:border-foreground/30">
      <div className="relative mx-auto aspect-[3/4] w-[76%] overflow-hidden rounded-md border border-border bg-background shadow-sm">
        <CourseCover course={course} />
        <div className="absolute inset-x-0 bottom-0 h-1 bg-background/70">
          <div className="h-1" style={{ width: `${Math.round(studied * 100)}%`, background: color }} />
        </div>
      </div>
      <h3 className="line-clamp-2 text-meta font-medium leading-snug" title={course.title}>
        <Link href={`/courses/${course.id}`} className="after:absolute after:inset-0">
          {course.title}
        </Link>
      </h3>
      <p className="text-micro tabular-nums text-muted-foreground">
        <StatusText studied={studied} />
      </p>
      {also.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {also.map((a) => (
            <span key={a} className="rounded border border-dashed border-border px-1.5 py-px text-micro text-muted-foreground">
              also {a}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

// ── Dialogs ────────────────────────────────────────────────────────────────────────────

export type ProgramDialogState = { mode: "new" } | { mode: "edit"; id: string; name: string; goal: string } | null

export function ProgramDialog({
  state,
  onClose,
  onSubmit,
}: {
  state: ProgramDialogState
  onClose: () => void
  onSubmit: (name: string, goal: string) => void
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{state && <ProgramForm key={state.mode} state={state} onClose={onClose} onSubmit={onSubmit} />}</DialogContent>
    </Dialog>
  )
}

function ProgramForm({ state, onClose, onSubmit }: { state: Exclude<ProgramDialogState, null>; onClose: () => void; onSubmit: (n: string, g: string) => void }) {
  const [name, setName] = useState(state.mode === "edit" ? state.name : "")
  const [goal, setGoal] = useState(state.mode === "edit" ? state.goal : "")
  const submit = () => name.trim() && onSubmit(name, goal)
  return (
    <>
      <DialogHeader>
        <DialogTitle>{state.mode === "edit" ? "Edit program" : "New program"}</DialogTitle>
        <DialogDescription>A program is a goal made of tracks, like a degree. Courses count toward it as you study them.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="program-name">Name</Label>
          <Input id="program-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Data Science" autoFocus onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="program-goal">Goal</Label>
          <Input id="program-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Work as a data scientist" onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>{state.mode === "edit" ? "Save" : "Create"}</Button>
      </DialogFooter>
    </>
  )
}

export type TrackDialogState = { mode: "new" } | { mode: "edit"; id: string; name: string; rule: TrackRule; count: number } | null

export function TrackDialog({ state, onClose, onSubmit }: { state: TrackDialogState; onClose: () => void; onSubmit: (name: string, rule: TrackRule) => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{state && <TrackForm key={state.mode} state={state} onClose={onClose} onSubmit={onSubmit} />}</DialogContent>
    </Dialog>
  )
}

function TrackForm({ state, onClose, onSubmit }: { state: Exclude<TrackDialogState, null>; onClose: () => void; onSubmit: (n: string, r: TrackRule) => void }) {
  const [name, setName] = useState(state.mode === "edit" ? state.name : "")
  const [kind, setKind] = useState<"all" | "any">(state.mode === "edit" ? state.rule.kind : "all")
  const [n, setN] = useState(state.mode === "edit" && state.rule.kind === "any" ? state.rule.n : 2)
  const submit = () => name.trim() && onSubmit(name, kind === "all" ? { kind: "all" } : { kind: "any", n: Math.max(1, n) })
  return (
    <>
      <DialogHeader>
        <DialogTitle>{state.mode === "edit" ? "Edit track" : "New track"}</DialogTitle>
        <DialogDescription>A track is a set of courses inside the program, in the order you would take them.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="track-name">Name</Label>
          <Input id="track-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Machine Learning" autoFocus onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div className="space-y-1.5">
          <Label>What counts</Label>
          <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as "all" | "any")}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every course</SelectItem>
                <SelectItem value="any">Any number of them</SelectItem>
              </SelectContent>
            </Select>
            {kind === "any" && (
              <Input type="number" min={1} value={n} onChange={(e) => setN(Number(e.target.value) || 1)} className="w-20" aria-label="How many courses count" />
            )}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!name.trim()}>{state.mode === "edit" ? "Save" : "Create"}</Button>
      </DialogFooter>
    </>
  )
}

/** Pick courses to put into a track; ones already in it are ticked and fixed. */
export function AddCoursesDialog({
  open,
  title,
  courses,
  already,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  courses: Course[]
  already: string[]
  onClose: () => void
  onSubmit: (ids: string[]) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {open && <AddCoursesForm title={title} courses={courses} already={already} onClose={onClose} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  )
}

function AddCoursesForm({ title, courses, already, onClose, onSubmit }: { title: string; courses: Course[]; already: string[]; onClose: () => void; onSubmit: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const [q, setQ] = useState("")
  const list = courses.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add courses to {title}</DialogTitle>
        <DialogDescription>A course can count toward more than one track and program.</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses…" className="pl-8" autoFocus />
      </div>
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        {list.map((c) => {
          const fixed = already.includes(c.id)
          const on = fixed || picked.includes(c.id)
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={fixed}
                onClick={() => toggle(c.id)}
                className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-meta hover:bg-muted disabled:opacity-60", on && !fixed && "bg-muted")}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-background" : "border-border")}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: coverColor(c.title) }} />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {fixed && <span className="text-micro text-muted-foreground">in this track</span>}
              </button>
            </li>
          )
        })}
        {list.length === 0 && <li className="px-2 py-3 text-meta text-muted-foreground">No courses match.</li>}
      </ul>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit(picked)} disabled={picked.length === 0}>
          Add {picked.length || ""} {picked.length === 1 ? "course" : "courses"}
        </Button>
      </DialogFooter>
    </>
  )
}
