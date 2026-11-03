"use client"

/** Data hooks for the Process dashboard: the learn service's book list, one book's
 *  chapters, its build queue (polled while anything is queued or running) and the
 *  enqueue / cancel writes. Views stay presentational; every read and write lives here. */

import { useMemo } from "react"
import { fetchCourseChapters } from "@/gateways/api/chapter"
import { numberSections, numberedSectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { cancelChapterBuild, enqueueChapterBuild, type BuildKind, type ChapterBuildJob } from "@/gateways/api/pipeline"
import { fetchChapterBuilds, fetchLearnDocuments } from "@/gateways/api/system"
import { qk, roots, useApi, useApiMutation } from "@/kit/data"

/** What a build write changes: the queue on this page, the machine strip, and the
 *  course-side reads a finished build feeds (concepts, chapter state, staleness). */
export const BUILD_INVALIDATES = [roots.jobs, roots.system, roots.courseStatus]

export function useLearnDocuments() {
  return useApi(qk.learnDocuments(), (signal) => fetchLearnDocuments(signal))
}

export function useChapters(docId: string | null) {
  return useApi(qk.chapters(docId ?? ""), (signal) => fetchCourseChapters(docId!, signal), {
    enabled: !!docId,
  })
}

const isActive = (b: ChapterBuildJob) => b.status === "queued" || b.status === "running"

/** The build queue for one book. Polls every 8 s while any job is queued or running. */
export function useBuilds(docId: string | null) {
  return useApi(qk.jobs(docId ?? ""), (signal) => fetchChapterBuilds(docId!, signal), {
    enabled: !!docId,
    poll: (d) => (d?.builds.some(isActive) ? 8000 : false),
  })
}

/** Numbered display names via the SAME numberSections/numberedSectionTitle the syllabus
 *  tree uses, so the two surfaces render identical strings by construction. */
export function useChapterNames(chapters: { key: string; title: string; label?: string }[]) {
  return useMemo(() => {
    const nodes: LearnTreeNode[] = chapters.map((c) => ({
      id: c.key,
      label: c.label || c.title,
      title: c.title,
      sectionKey: c.key,
      isSection: true,
      children: [],
    }))
    const numbers = numberSections(nodes)
    const out = new Map<string, string>()
    for (const n of nodes) out.set(n.id, numberedSectionTitle(numbers.get(n.id), n.label, n.title))
    return out
  }, [chapters])
}

export type EnqueueVars = { docId: string; scope: string; at: number | null }
export type CancelVars = { docId: string; scope: string; kind?: BuildKind }

export function useEnqueueBuild() {
  return useApiMutation((v: EnqueueVars) => enqueueChapterBuild(v.docId, v.scope, v.at), {
    invalidates: BUILD_INVALIDATES,
  })
}

export function useCancelBuild() {
  return useApiMutation((v: CancelVars) => cancelChapterBuild(v.docId, v.scope, v.kind), {
    invalidates: BUILD_INVALIDATES,
  })
}
