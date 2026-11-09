"use client"

import { qk, roots, useApi, useApiMutation } from "@/kit/data"
import { fetchPack, gradeSkill, saveScopeNotes, type Pack } from "@/gateways/api/packs"

/** Data hooks for one exam pack.
 *
 *  A unit page and the Today review set are DRAWS: each GET marks its questions as seen
 *  (backend packs.learn_unit / review_set), so refetching one burns unseen questions and
 *  swaps the cards under the learner. qk keeps them under roots.packDraw, outside every
 *  invalidation. Writes here still use the narrow `packWrites` (Today and the badges)
 *  rather than PACK_INVALIDATES, so an open sitting is never refetched mid-answer; the
 *  pack itself is refreshed through its query's retry(). Draws are read with
 *  `staleMs: Infinity` so focus never refetches. */

/** What a pack write (grade, progress, sitting) makes stale, minus the draws. */
export const packWrites = (packKey: string): (readonly unknown[])[] => [qk.packToday(packKey), roots.packs, roots.activity]

const building = (p: Pack | undefined) =>
  p?.status === "building" || Boolean(p?.units.some((u) => u.status === "queued" || u.status === "building"))

/** The pack, polled every 5 s while any chapter is still building. */
export function usePack(packKey: string) {
  return useApi(qk.pack(packKey), (signal) => fetchPack(packKey, signal), {
    poll: (d) => (building(d) ? 5000 : false),
  })
}

/** One Good/Again on a skill's long-term row. `onSaved` runs only once the grade landed. */
export function useGradeSkill(packKey: string, skill: string, onSaved?: (correct: boolean) => void) {
  return useApiMutation((correct: boolean) => gradeSkill(packKey, skill, correct), {
    invalidates: packWrites(packKey),
    onSuccess: (_r, correct) => onSaved?.(correct),
  })
}

/** Save new scope notes; the pack query then polls while the reweight runs. */
export function useSaveScopeNotes(packKey: string) {
  return useApiMutation((notes: string) => saveScopeNotes(packKey, notes), {
    invalidates: [qk.pack(packKey), roots.packs],
  })
}
