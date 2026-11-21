"use client"

/** Level 1 · Library home (programs canvas board "L1-Home", 2026-11-21): each program as a wide
 *  banner on top of the shelf — goal on the left, a bar per track, credits and Continue on the
 *  right. The course cards below stay as they are. */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { GraduationCap } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data"
import { chapterHref } from "@/kit/lib/scope-url"
import { Bar, ProgramDialog, trackColor, type ProgramDialogState } from "@/surfaces/programs/program-ui"
import { addProgram, nextInProgram, num, pctOf, programProgress, trackProgress, type Program } from "@/surfaces/programs/programs"
import { useProgramCourses, usePrograms, type ProgramCourses } from "@/surfaces/programs/use-programs"

export function continueHref(courses: ProgramCourses, courseId: string) {
  const key = courses.continueKey(courseId)
  return key ? chapterHref(courseId, key) : `/courses/${courseId}`
}

export function ProgramBanners() {
  const programs = usePrograms()
  const courses = useProgramCourses()
  const router = useRouter()
  const [dialog, setDialog] = useState<ProgramDialogState>(null)
  if (!programs.ready) return null
  const list = programs.state.programs

  return (
    <section aria-label="Programs" className="mb-6 flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-micro uppercase tracking-label text-muted-foreground">Programs · {list.length}</h2>
        {list.length > 0 && (
          <button type="button" onClick={() => setDialog({ mode: "new" })} className="ml-auto text-meta font-medium text-brand hover:underline">
            + New program
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <button
          type="button"
          onClick={() => setDialog({ mode: "new" })}
          className="flex items-center gap-3 rounded-xl border border-dashed border-border px-5 py-4 text-left text-meta text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
        >
          <GraduationCap className="h-5 w-5 shrink-0" />
          <span className="flex-1">Group courses into a program, like a degree: tracks of courses that build toward a goal.</span>
          <span className="font-medium text-brand">+ New program</span>
        </button>
      ) : (
        list.map((p) => <Banner key={p.id} program={p} courses={courses} />)
      )}
      {programs.saveError && <ErrorNotice compact title="Not saved" error={programs.saveError} onRetry={programs.retry} />}
      <ProgramDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSubmit={(name, goal) => {
          let id = ""
          programs.update((s) => {
            const r = addProgram(s, name, goal)
            id = r.id
            return r.state
          })
          setDialog(null)
          if (id) router.push(`/programs/${id}`)
        }}
      />
    </section>
  )
}

function Banner({ program, courses }: { program: Program; courses: ProgramCourses }) {
  const total = programProgress(program, courses.concepts)
  const next = nextInProgram(program, courses.share, courses.exists)
  const courseCount = total.count
  return (
    <article className="group relative grid gap-5 rounded-2xl border border-border bg-card px-6 py-5 transition-colors hover:border-foreground/30 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="text-micro uppercase tracking-label text-muted-foreground">Program</p>
        <h3 className="font-serif text-[1.5rem] font-semibold leading-tight">
          <Link href={`/programs/${program.id}`} className="after:absolute after:inset-0">
            {program.name}
          </Link>
        </h3>
        {program.goal && <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">{program.goal}</p>}
        <p className="mt-1 text-micro text-muted-foreground">
          {program.tracks.length} {program.tracks.length === 1 ? "track" : "tracks"} · {courseCount} {courseCount === 1 ? "course" : "courses"}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {program.tracks.length === 0 && <p className="text-meta text-muted-foreground">No tracks yet. Open the program to add one.</p>}
        {program.tracks.slice(0, 4).map((t, i) => {
          const p = trackProgress(t, courses.concepts)
          return (
            <div key={t.id} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-meta">
              <span className="truncate">{t.name}</span>
              <Bar value={pctOf(p)} color={trackColor(i)} />
              <span className="tabular-nums text-muted-foreground">
                {p.done}/{p.count} done
              </span>
            </div>
          )
        })}
        {program.tracks.length > 4 && <p className="text-micro text-muted-foreground">+ {program.tracks.length - 4} more tracks</p>}
      </div>
      <div className="flex items-center gap-4 md:flex-col md:items-end md:gap-2">
        <div className="tabular-nums md:text-right">
          <p>
            <span className="font-serif text-[1.5rem] font-semibold">{total.done}</span>
            <span className="text-meta text-muted-foreground"> of {total.count} courses done</span>
          </p>
          <p className="text-micro text-muted-foreground">
            {num(total.studied)} of {num(total.total)} concepts studied
          </p>
        </div>
        {next && (
          <Button asChild size="sm" className="relative z-10">
            <Link href={continueHref(courses, next)} title={courses.get(next)?.title}>
              Continue
            </Link>
          </Button>
        )}
      </div>
    </article>
  )
}
