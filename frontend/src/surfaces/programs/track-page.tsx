"use client"

/** Level 3 · Track (canvas board "L3-Track", 2026-11-21): a track inside a program as an
 *  ordered requirement list — numbered rows in the order to take them, each with its status
 *  and credits — and side panels for credits, what is up next, and courses shared with other
 *  tracks. */

import Link from "next/link"
import { useState } from "react"
import { ArrowDown, ArrowUp, Check, Plus, X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data"
import { EmptyState } from "@/kit/patterns/empty-state"
import { cn } from "@/kit/lib/utils"
import { CourseCover } from "@/surfaces/library"
import { continueHref } from "@/surfaces/programs/program-banners"
import { AddCoursesDialog, Bar, StatusText, TrackDialog, trackColor, type TrackDialogState } from "@/surfaces/programs/program-ui"
import {
  addCourses,
  countLabel,
  moveCourse,
  nextInTrack,
  num,
  otherPlaces,
  pctOf,
  removeCourse,
  renameTrack,
  shareOf,
  statusOf,
  trackProgress,
} from "@/surfaces/programs/programs"
import { useProgramCourses, usePrograms } from "@/surfaces/programs/use-programs"

export function TrackPage({ programId, trackId }: { programId: string; trackId: string }) {
  const programs = usePrograms()
  const courses = useProgramCourses()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TrackDialogState>(null)

  if (!programs.ready) return <p className="text-meta text-muted-foreground">Loading…</p>
  const program = programs.state.programs.find((p) => p.id === programId)
  const index = program?.tracks.findIndex((t) => t.id === trackId) ?? -1
  const track = index >= 0 ? program!.tracks[index] : undefined
  if (!program || !track) {
    return (
      <EmptyState
        title="This track is gone"
        description="It may have been removed from its program."
        action={
          <Button asChild variant="outline">
            <Link href={program ? `/programs/${program.id}` : "/courses"}>{program ? `Back to ${program.name}` : "Back to the Library"}</Link>
          </Button>
        }
      />
    )
  }

  const s = programs.state
  const color = trackColor(index)
  const p = trackProgress(track, courses.concepts)
  const ids = track.courseIds.filter(courses.exists)
  const next = nextInTrack(track, courses.share, courses.exists)
  const shared = ids.map((id) => ({ id, places: otherPlaces(s, id, track.id) })).filter((x) => x.places.length > 0)
  const update = programs.update

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="text-micro uppercase tracking-label text-muted-foreground">
            Track in{" "}
            <Link href={`/programs/${program.id}`} className="text-foreground/80 hover:underline">
              {program.name}
            </Link>
          </p>
          <h1 className="flex items-center gap-3 font-serif text-[1.75rem] font-semibold leading-tight">
            <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: color }} />
            {track.name}
          </h1>
          <p className="text-meta text-muted-foreground">
            {countLabel(track)} · take them in this order
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: "edit", id: track.id, name: track.name })}>
            Rename track
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus />
            Add courses
          </Button>
        </div>
      </header>
      {programs.saveError && <ErrorNotice compact title="Not saved" error={programs.saveError} onRetry={programs.retry} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <ol className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
          {ids.length === 0 && (
            <li className="px-5 py-6 text-meta text-muted-foreground">
              No courses in this track yet.{" "}
              <button type="button" onClick={() => setAdding(true)} className="font-medium text-brand hover:underline">
                Add courses
              </button>
            </li>
          )}
          {ids.map((id, i) => {
            const c = courses.get(id)!
            const concepts = courses.concepts(id)
            const studied = shareOf(concepts)
            const st = statusOf(studied)
            const places = Array.from(new Set(otherPlaces(s, id, track.id).map((x) => (x.program.id === program.id ? x.track.name : `${x.program.name} › ${x.track.name}`))))
            return (
              <li key={id} className={cn("group relative flex items-center gap-4 px-5 py-3.5", i > 0 && "border-t border-border", id === next && "bg-brand/5")}>
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-meta font-semibold tabular-nums",
                    st === "done" ? "border-transparent bg-status-mastered text-background" : "border-border text-muted-foreground",
                  )}
                >
                  {st === "done" ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <div className="relative aspect-[3/4] w-10 shrink-0 overflow-hidden rounded border border-border bg-background">
                  <CourseCover course={c} small />
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/courses/${c.id}`} className="line-clamp-1 font-medium hover:underline" title={c.title}>
                    {c.title}
                  </Link>
                  <p className="flex flex-wrap items-center gap-x-3 text-micro text-muted-foreground">
                    <StatusText concepts={concepts} />
                    {id === next && <span className="font-medium text-brand">Up next</span>}
                    {places.length > 0 && <span>also counts toward {places.join(", ")}</span>}
                  </p>
                  {st === "going" && <Bar value={studied * 100} color={color} className="mt-1 h-1 w-40" />}
                </div>
                <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} aria-label={`Move ${c.title} up`} onClick={() => update((x) => moveCourse(x, program.id, track.id, id, -1))}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === ids.length - 1} aria-label={`Move ${c.title} down`} onClick={() => update((x) => moveCourse(x, program.id, track.id, id, 1))}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Take ${c.title} out of this track`} onClick={() => update((x) => removeCourse(x, program.id, track.id, id))}>
                    <X />
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>

        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="text-micro uppercase tracking-label text-muted-foreground">Progress</p>
            <p className="mt-1 tabular-nums">
              <span className="font-serif text-[1.75rem] font-semibold">{p.done}</span>
              <span className="text-meta text-muted-foreground"> of {p.count} courses done</span>
            </p>
            <Bar value={pctOf(p)} color={color} className="mt-2" />
            <p className="mt-2 text-meta tabular-nums text-muted-foreground">
              {num(p.studied)} of {num(p.total)} concepts studied
            </p>
          </section>
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="text-micro uppercase tracking-label text-muted-foreground">Up next in this track</p>
            {next ? (
              <>
                <p className="mt-1.5 font-medium leading-snug">{courses.get(next)?.title}</p>
                <p className="text-micro text-muted-foreground">
                  <StatusText concepts={courses.concepts(next)} />
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link href={continueHref(courses, next)}>{courses.continueKey(next) ? "Continue reading" : "Start"}</Link>
                </Button>
              </>
            ) : (
              <p className="mt-1.5 text-meta text-muted-foreground">{ids.length ? "Every course here is done." : "Add a course to start."}</p>
            )}
          </section>
          {shared.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5">
              <p className="text-micro uppercase tracking-label text-muted-foreground">Shared with other tracks</p>
              <ul className="mt-2 flex flex-col gap-2">
                {shared.map(({ id, places }) => (
                  <li key={id} className="text-meta">
                    <p className="line-clamp-1 font-medium">{courses.get(id)?.title}</p>
                    <p className="text-micro text-muted-foreground">
                      {places.map((x, k) => (
                        <span key={x.track.id}>
                          {k > 0 && ", "}
                          <Link href={`/programs/${x.program.id}/tracks/${x.track.id}`} className="hover:underline">
                            {x.program.id === program.id ? x.track.name : `${x.program.name} › ${x.track.name}`}
                          </Link>
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <AddCoursesDialog
        open={adding}
        title={track.name}
        courses={courses.courses}
        already={track.courseIds}
        onClose={() => setAdding(false)}
        onSubmit={(picked) => {
          update((x) => addCourses(x, program.id, track.id, picked))
          setAdding(false)
        }}
      />
      <TrackDialog
        state={editing}
        onClose={() => setEditing(null)}
        onSubmit={(name) => {
          update((x) => renameTrack(x, program.id, track.id, name))
          setEditing(null)
        }}
      />
    </div>
  )
}
