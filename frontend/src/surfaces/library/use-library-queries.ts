"use client"

/** The reads the Library and the course home share, each through the one cache, so the
 *  shelf, the Today panel, the course home and the nav badge never disagree. */

import { fetchMasteryOverall, fetchStudyDebt } from "@/gateways/api/progress"
import { fetchPacks, fetchToday } from "@/gateways/api/packs"
import { fetchReadingPositions } from "@/gateways/api/user-settings"
import { qk, useApi, orThrow } from "@/kit/data"

/** Whole-library due rollup (the same read as the nav's Plan badge). */
export function useStudyDebt() {
  return useApi(qk.studyDebt(7), (signal) => fetchStudyDebt(7, signal).then(orThrow))
}

/** courseId → sectionKey to continue reading at. */
export function useReadingPositions() {
  return useApi(qk.readingProgress(), (signal) => fetchReadingPositions(signal))
}

/** A course's exam packs. Polls while one is building, like the packs screen. */
export function usePacks(docId: string | undefined, enabled = true) {
  return useApi(qk.packs(docId ?? ""), (signal) => fetchPacks(docId as string, signal), {
    enabled: enabled && !!docId,
    poll: (d) => (d?.packs.some((p) => p.status === "building") ? 5000 : false),
  })
}

/** One pack's "do this now" plan. */
export function usePackToday(packKey: string | undefined, enabled = true) {
  return useApi(qk.packToday(packKey ?? ""), (signal) => fetchToday(packKey as string, signal), {
    enabled: enabled && !!packKey,
  })
}

/** Every shelf course's studied share in one read. Keyed under the mastery root, so it
 *  refreshes whenever a review invalidates mastery. */
export function useShelfMastery(docIds: string[]) {
  const key = [...docIds].sort().join(",")
  return useApi([...qk.mastery("shelf"), key], (signal) => fetchMasteryOverall(key.split(","), signal).then(orThrow), {
    enabled: key.length > 0,
  })
}
