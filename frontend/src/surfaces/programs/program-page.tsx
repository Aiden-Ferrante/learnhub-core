"use client"

/** Level 2 · Program (canvas board "L2-Program", 2026-11-21: "I like the program page"): a hero
 *  with the goal and a credits bar broken down by track, then each track as a shelf of course
 *  cards. A course in two tracks shows in both, tagged "also …". */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { ChevronRight, MoreVertical, Plus } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data"
import { EmptyState } from "@/kit/patterns/empty-state"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/kit/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/kit/ui/dropdown-menu"
import { continueHref } from "@/surfaces/programs/program-banners"
import {
  AddCoursesDialog,
  Bar,
  ProgramCourseCard,
  ProgramDialog,
  SegmentedBar,
  TrackDialog,
  trackColor,
  type ProgramDialogState,
  type TrackDialogState,
} from "@/surfaces/programs/program-ui"
import {
  addCourses,
  addTrack,
  countLabel,
  editProgram,
  moveTrack,
  nextInProgram,
  num,
  otherPlaces,
  pctOf,
  programProgress,
  removeProgram,
  removeTrack,
  renameTrack,
  trackProgress,
  type Program,
  type ProgramTrack,
  type Progress,
} from "@/surfaces/programs/programs"
import { useProgramCourses, usePrograms } from "@/surfaces/programs/use-programs"

export function ProgramPage({ programId }: { programId: string }) {
  const programs = usePrograms()
  const courses = useProgramCourses()
  const router = useRouter()
  const [programDialog, setProgramDialog] = useState<ProgramDialogState>(null)
  const [trackDialog, setTrackDialog] = useState<TrackDialogState>(null)
  const [adding, setAdding] = useState<ProgramTrack | null>(null)
  const [confirm, setConfirm] = useState<{ kind: "program" } | { kind: "track"; track: ProgramTrack } | null>(null)

  if (!programs.ready) return <p className="text-meta text-muted-foreground">Loading…</p>
  const program = programs.state.programs.find((p) => p.id === programId)
  if (!program) {
    return (
      <EmptyState
        title="This program is gone"
        description="It may have been deleted."
        action={
          <Button asChild variant="outline">
            <Link href="/courses">Back to the Library</Link>
          </Button>
        }
      />
    )
  }

  const s = programs.state
  const total = programProgress(program, courses.concepts)
  const next = nextInProgram(program, courses.share, courses.exists)

  return (
    <div className="flex flex-col gap-8">
      <Hero
        program={program}
        parts={program.tracks.map((t, i) => ({ ...trackProgress(t, courses.concepts), color: trackColor(i), name: t.name }))}
        total={total}
        nextHref={next ? continueHref(courses, next) : null}
        nextTitle={next ? courses.get(next)?.title : undefined}
        onEdit={() => setProgramDialog({ mode: "edit", id: program.id, name: program.name, goal: program.goal })}
        onDelete={() => setConfirm({ kind: "program" })}
      />
      {programs.saveError && <ErrorNotice compact title="Not saved" error={programs.saveError} onRetry={programs.retry} />}

      {program.tracks.map((t, i) => (
        <TrackShelf
          key={t.id}
          program={program}
          track={t}
          index={i}
          courses={courses}
          state={s}
          onAdd={() => setAdding(t)}
          onEdit={() => setTrackDialog({ mode: "edit", id: t.id, name: t.name })}
          onMove={(dir) => programs.update((x) => moveTrack(x, program.id, t.id, dir))}
          onRemove={() => setConfirm({ kind: "track", track: t })}
        />
      ))}

      <button
        type="button"
        onClick={() => setTrackDialog({ mode: "new" })}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-5 py-5 text-meta text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
        {program.tracks.length ? "New track" : "Add the first track (e.g. Machine Learning, Python)"}
      </button>

      <ProgramDialog
        state={programDialog}
        onClose={() => setProgramDialog(null)}
        onSubmit={(name, goal) => {
          programs.update((x) => editProgram(x, program.id, name, goal))
          setProgramDialog(null)
        }}
      />
      <TrackDialog
        state={trackDialog}
        onClose={() => setTrackDialog(null)}
        onSubmit={(name) => {
          const d = trackDialog
          if (d?.mode === "edit") programs.update((x) => renameTrack(x, program.id, d.id, name))
          else programs.update((x) => addTrack(x, program.id, name).state)
          setTrackDialog(null)
        }}
      />
      <AddCoursesDialog
        open={adding !== null}
        title={adding?.name ?? ""}
        courses={courses.courses}
        already={adding?.courseIds ?? []}
        onClose={() => setAdding(null)}
        onSubmit={(picked) => {
          if (adding) programs.update((x) => addCourses(x, program.id, adding.id, picked))
          setAdding(null)
        }}
      />
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "track" ? `Remove the ${confirm.track.name} track?` : `Delete ${program.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "track"
                ? "Its courses stay in the Library and in any other track; only this list goes."
                : "Its tracks go too. The courses stay in the Library and keep everything you studied."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const c = confirm
                setConfirm(null)
                if (c?.kind === "track") programs.update((x) => removeTrack(x, program.id, c.track.id))
                else if (c?.kind === "program") {
                  programs.update((x) => removeProgram(x, program.id))
                  router.push("/courses")
                }
              }}
            >
              {confirm?.kind === "track" ? "Remove" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Hero({
  program,
  parts,
  total,
  nextHref,
  nextTitle,
  onEdit,
  onDelete,
}: {
  program: Program
  parts: (Progress & { color: string; name: string })[]
  total: Progress
  nextHref: string | null
  nextTitle?: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <header className="relative flex flex-col gap-5 rounded-2xl border border-border bg-card px-7 py-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 pr-8">
        <div className="min-w-[12rem] flex-1">
          <p className="text-micro uppercase tracking-label text-muted-foreground">Program</p>
          <h1 className="font-serif text-[2rem] font-semibold leading-tight">{program.name}</h1>
          {program.goal && <p className="mt-1 max-w-2xl text-body text-muted-foreground">{program.goal}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-1 sm:items-end sm:text-right">
          <p className="tabular-nums">
            <span className="font-serif text-[2rem] font-semibold leading-none">{total.done}</span>
            <span className="text-meta text-muted-foreground"> of {total.count} courses done</span>
          </p>
          <p className="text-meta tabular-nums text-muted-foreground">
            {num(total.studied)} of {num(total.total)} concepts studied
            {total.going > 0 && ` · ${total.going} in progress`}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="absolute right-3 top-3 h-8 w-8 text-muted-foreground" aria-label="Program actions">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onEdit}>Edit name and goal</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-ink-danger focus:text-ink-danger" onSelect={onDelete}>
              Delete program…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <SegmentedBar parts={parts} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-meta">
        {parts.map((p) => (
          <span key={p.name} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
            <span className="tabular-nums text-muted-foreground">
              {p.done}/{p.count} done
            </span>
          </span>
        ))}
        {nextHref && (
          <Button asChild size="sm" className="ml-auto max-w-full">
            <Link href={nextHref} title={nextTitle}>
              <span className="truncate">Continue{nextTitle ? ` · ${nextTitle}` : ""}</span>
            </Link>
          </Button>
        )}
      </div>
    </header>
  )
}

function TrackShelf({
  program,
  track,
  index,
  courses,
  state,
  onAdd,
  onEdit,
  onMove,
  onRemove,
}: {
  program: Program
  track: ProgramTrack
  index: number
  courses: ReturnType<typeof useProgramCourses>
  state: ReturnType<typeof usePrograms>["state"]
  onAdd: () => void
  onEdit: () => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const p = trackProgress(track, courses.concepts)
  const color = trackColor(index)
  const href = `/programs/${program.id}/tracks/${track.id}`
  const list = track.courseIds.map((id) => courses.get(id)).filter((c) => c !== undefined)
  return (
    <section aria-label={track.name} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border pb-2">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <h2 className="font-serif text-section font-semibold">
          <Link href={href} className="hover:underline">
            {track.name}
          </Link>
        </h2>
        <span className="text-meta text-muted-foreground">{countLabel(track)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <Bar value={pctOf(p)} color={color} className="hidden w-32 sm:block" />
          <span className="text-meta tabular-nums text-muted-foreground">
            {p.done}/{p.count} done · {pctOf(p)}% of concepts
          </span>
          <Link href={href} className="flex items-center text-meta font-medium text-brand hover:underline">
            Open track <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`${track.name} actions`}>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={onAdd}>Add courses…</DropdownMenuItem>
              <DropdownMenuItem onSelect={onEdit}>Rename track…</DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>Move up</DropdownMenuItem>
              <DropdownMenuItem disabled={index === program.tracks.length - 1} onSelect={() => onMove(1)}>Move down</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-ink-danger focus:text-ink-danger" onSelect={onRemove}>
                Remove track…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-5">
        {list.map((c) => (
          <ProgramCourseCard
            key={c.id}
            course={c}
            concepts={courses.concepts(c.id)}
            also={Array.from(new Set(otherPlaces(state, c.id, track.id).map((x) => (x.program.id === program.id ? x.track.name : x.program.name))))}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-[180px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-meta text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
        >
          <Plus className="h-5 w-5" />
          Add courses
        </button>
      </div>
    </section>
  )
}
