"use client"

/** Programs from user settings (`programs`), plus what every program screen reads about the
 *  courses: the course list, each course's studied share (ONE shelf-mastery read) and its
 *  saved reading place. Edits write through the query cache first, so every screen sees them
 *  at once, then save the WHOLE state in one serial lane (the settings PUT merges top-level
 *  keys). Edits are refused until settings have loaded. */

import { useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { fetchUserSettings, saveUserSettings } from "@/gateways/api/user-settings"
import { useApi, useApiMutation } from "@/kit/data"
import { courseFromDocument, type Course } from "@/surfaces/library/courses"
import { useReadingPositions, useShelfMastery } from "@/surfaces/library/use-library-queries"
import { useDocuments } from "@/surfaces/processing"
import { normalizePrograms, shareOf, type ProgramsState } from "@/surfaces/programs/programs"

export const PROGRAMS_KEY = ["user-settings", "programs"] as const

export function usePrograms() {
  const client = useQueryClient()
  const query = useApi([...PROGRAMS_KEY], (signal) => fetchUserSettings(signal).then((s) => normalizePrograms(s.programs)))
  const save = useApiMutation((next: ProgramsState) => saveUserSettings({ programs: next }), { serialKey: "programs" })
  const state = query.data
  const update = (change: (prev: ProgramsState) => ProgramsState) => {
    const prev = client.getQueryData<ProgramsState>([...PROGRAMS_KEY])
    if (!prev) return
    const next = change(prev)
    client.setQueryData([...PROGRAMS_KEY], next)
    save.fire(next)
  }
  return {
    query,
    state: state ?? { programs: [] },
    ready: state !== undefined,
    update,
    saveError: save.error,
    retry: () => state && save.fire(state),
  }
}
export type ProgramsApi = ReturnType<typeof usePrograms>

export function useProgramCourses() {
  const { documents, isInitialized } = useDocuments()
  const courses = useMemo(() => documents.map(courseFromDocument), [documents])
  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses])
  const mastery = useShelfMastery(
    useMemo(() => courses.filter((c) => c.status === "ready" && c.learnDocId).map((c) => c.learnDocId as string), [courses]),
  )
  const positions = useReadingPositions()
  /** A course's concepts and how many you have studied (reviewed at least once). */
  const concepts = (id: string) => {
    const doc = byId.get(id)?.learnDocId
    const m = doc ? mastery.data?.overall[doc] : undefined
    return { studied: m?.reviewed ?? 0, total: m?.total ?? 0 }
  }
  /** 0..1 share of the course's concepts studied. */
  const share = (id: string) => shareOf(concepts(id))
  return {
    courses,
    byId,
    get: (id: string): Course | undefined => byId.get(id),
    exists: (id: string) => byId.has(id),
    concepts,
    share,
    continueKey: (id: string) => positions.data?.[id] ?? null,
    isInitialized,
  }
}
export type ProgramCourses = ReturnType<typeof useProgramCourses>
