"use client"

import { useCallback, useEffect, useRef, useState, type DependencyList } from "react"

/** THE fetch-into-state primitive — replaces the hand-rolled
 *  `useState + useEffect(alive-flag fetch)` idiom (fourteen copies existed before this).
 *
 *  - `fetcher` returning `null` skips the load (e.g. a missing doc id) without an error.
 *  - Errors land in `error`; `data` keeps its last good value (supplementary panels keep
 *    rendering through a transient failure, matching the idiom this replaces).
 *  - `reload` re-runs with the same staleness guard — safe to call after a mutation.
 *  - A late response from a superseded run (deps changed, unmount) is discarded. */
export function useAsyncData<T>(
  fetcher: () => Promise<T> | null,
  deps: DependencyList,
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const run = useRef(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => {
    const p = fetcher()
    if (p === null) {
      setData(null)
      setLoading(false)
      return
    }
    const id = ++run.current
    setLoading(true)
    p.then((d) => {
      if (id !== run.current) return
      setData(d)
      setError(null)
    })
      .catch((e) => {
        if (id !== run.current) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (id === run.current) setLoading(false)
      })
  }, deps)

  useEffect(() => {
    load()
    // Invalidate in-flight runs when deps change/unmount so a late response can't land.
    return () => {
      run.current++
    }
  }, [load])

  return { data, loading, error, reload: load }
}
