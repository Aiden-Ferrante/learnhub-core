"use client"

/** Course tags from user settings (`courseTags`). Edits write through the query cache, then save
 *  the WHOLE map in one serial lane (the settings PUT merges top-level keys). Refused until
 *  loaded. When nothing is saved yet, tags start from the retired course groups (and are saved). */

import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { fetchUserSettings, saveUserSettings } from "@/gateways/api/user-settings"
import { useApi, useApiMutation } from "@/kit/data"
import { normalizeTags, tagsFromGroups, type TagMap } from "@/surfaces/library/course-tags"

const KEY = ["user-settings", "course-tags"] as const

export function useCourseTags() {
  const client = useQueryClient()
  const query = useApi([...KEY], (signal) =>
    fetchUserSettings(signal).then((s) => {
      const saved = normalizeTags(s.courseTags)
      return { map: saved ?? tagsFromGroups(s.courseGroups), fromGroups: saved === null }
    }),
  )
  const save = useApiMutation((next: TagMap) => saveUserSettings({ courseTags: next }), { serialKey: "course-tags" })
  const { fire } = save

  // Save the carried-over groups once, so the old groups are never read again.
  const carry = query.data?.fromGroups && Object.keys(query.data.map).length > 0 ? query.data.map : null
  useEffect(() => {
    if (carry) fire(carry)
  }, [carry, fire])

  const update = (change: (prev: TagMap) => TagMap) => {
    const prev = client.getQueryData<{ map: TagMap; fromGroups: boolean }>([...KEY])
    if (!prev) return
    const map = change(prev.map)
    client.setQueryData([...KEY], { map, fromGroups: false })
    fire(map)
  }
  const map = query.data?.map ?? {}
  return { query, map, ready: query.data !== undefined, update, saveError: save.error, retry: () => fire(map) }
}
