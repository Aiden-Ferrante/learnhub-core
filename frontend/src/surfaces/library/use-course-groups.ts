"use client"

/** The shelf's course groups: read once from user settings, edited locally, and every edit
 *  saved in order (one serial lane). A failed save is shown ("Not saved · Retry"), never
 *  swallowed. Edits are refused until the saved groups have loaded, so an empty initial
 *  state can never overwrite them. */

import { useEffect, useMemo, useState } from "react"
import { fetchUserSettings, saveUserSettings } from "@/gateways/api/user-settings"
import { qk, useApi, useApiMutation } from "@/kit/data"
import {
  EMPTY_GROUPS_STATE,
  buildGroupTree,
  coursesInGroup,
  normalizeGroupsState,
  takeLegacyGroupsState,
  type GroupsState,
} from "@/surfaces/library/course-groups"

export function useCourseGroups() {
  const query = useApi(qk.groups(), (signal) =>
    fetchUserSettings(signal).then((s) => normalizeGroupsState(s.courseGroups)),
  )
  const save = useApiMutation((next: GroupsState) => saveUserSettings({ courseGroups: next }), {
    serialKey: "course-groups",
  })
  const { fire } = save

  // Local working copy, hydrated once from the server (or the legacy localStorage store).
  const [state, setState] = useState<GroupsState | null>(null)
  useEffect(() => {
    if (state !== null || query.data === undefined) return
    if (query.data) {
      setState(query.data)
      return
    }
    const legacy = takeLegacyGroupsState()
    setState(legacy ?? EMPTY_GROUPS_STATE)
    if (legacy) fire(legacy)
  }, [state, query.data, fire])

  const current = state ?? EMPTY_GROUPS_STATE
  const update = (change: (prev: GroupsState) => GroupsState) => {
    if (state === null) return
    const next = change(state)
    setState(next)
    fire(next)
  }

  const tree = useMemo(() => buildGroupTree(current.groups), [current.groups])
  // groupId → count of courses tagged into it (including descendants).
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const g of current.groups) out[g.id] = coursesInGroup(g.id, current.membership, current.groups).size
    return out
  }, [current])

  return {
    query,
    state: current,
    ready: state !== null,
    tree,
    counts,
    update,
    saveError: save.error,
    retrySave: () => fire(current),
  }
}

export type CourseGroupsApi = ReturnType<typeof useCourseGroups>
