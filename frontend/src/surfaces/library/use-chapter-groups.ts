"use client"

/** One course's chapter groups: the saved set (user settings `chapterGroups[courseId]`) or, when
 *  none is saved, the book's parts from the outline. Edits copy the automatic set first, then
 *  save the WHOLE map in one serial lane (the settings PUT merges top-level keys). Edits are
 *  refused until settings have loaded, so an empty state never overwrites saved groups. */

import { useEffect, useMemo, useState } from "react"
import { fetchOutline } from "@/gateways/api/outline"
import { fetchUserSettings, saveUserSettings } from "@/gateways/api/user-settings"
import { qk, unwrap, useApi, useApiMutation } from "@/kit/data"
import { autoGroups, normalizeMap, type ChapterGroup, type ChapterGroupsMap } from "@/surfaces/library/chapter-groups"

export function useChapterGroups(courseId: string, docId: string | null | undefined, chapterKeys: string[]) {
  const settings = useApi(["user-settings", "chapter-groups"], (signal) =>
    fetchUserSettings(signal).then((s) => normalizeMap(s.chapterGroups)),
  )
  const outline = useApi(qk.outline(docId), (signal) => unwrap(fetchOutline(docId ?? undefined, signal)), {
    enabled: Boolean(docId),
    staleMs: 5 * 60 * 1000,
  })
  const save = useApiMutation((next: ChapterGroupsMap) => saveUserSettings({ chapterGroups: next }), {
    serialKey: "chapter-groups",
  })

  const [map, setMap] = useState<ChapterGroupsMap | null>(null)
  useEffect(() => {
    if (map === null && settings.data) setMap(settings.data)
  }, [map, settings.data])

  const keysSig = chapterKeys.join("|")
  const auto = useMemo(
    () => autoGroups(outline.data?.outline ?? [], chapterKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the chapter list's content
    [outline.data, keysSig],
  )
  const saved = map?.[courseId]
  const groups: ChapterGroup[] = saved ? saved.groups : auto

  const update = (change: (prev: ChapterGroup[]) => ChapterGroup[]) => {
    if (map === null) return
    const next = { ...map, [courseId]: { groups: change(groups) } }
    setMap(next)
    save.fire(next)
  }
  /** Back to the book's parts (drops the saved copy). */
  const reset = () => {
    if (map === null) return
    const next = { ...map }
    delete next[courseId]
    setMap(next)
    save.fire(next)
  }

  return {
    groups,
    /** The shown groups are the book's own parts (nothing saved for this course). */
    isAuto: !saved,
    hasBookParts: auto.length > 0,
    ready: map !== null,
    update,
    reset,
    saveError: save.error,
    retry: () => map && save.fire(map),
  }
}
