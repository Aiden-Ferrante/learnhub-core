"use client"

import { qk, roots, useApi, useApiMutation } from "@/kit/data"
import { fetchPack, gradeSkill, type Pack } from "@/gateways/api/packs"

/** Data hooks for one exam pack.
 *
 *  Why not PACK_INVALIDATES: a unit page and the Today review set are DRAWS. Each GET
 *  marks its questions as seen (backend packs.learn_unit / review_set), so refetching one
 *  burns unseen questions and swaps the cards under the learner. Both live under
 *  qk.pack(key), so a pack write must never invalidate that prefix. Writes here
 *  invalidate Today and the badges, and the pack itself is refreshed EXACTLY through its
 *  query's retry(). Draws are read with `staleMs: Infinity` so focus never refetches. */

/** What a pack write (grade, progress, sitting) makes stale, minus the draws. */
export const packWrites = (packKey: string): (readonly unknown[])[] => [qk.packToday(packKey), roots.packs, roots.activity]

const building = (p: Pack | undefined) => Boolean(p?.units.some((u) => u.status === "queued" || u.status === "building"))

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
