"use client"

/** The data hooks every surface uses: `useApi` for reads, `useApiMutation` for writes.
 *  Thin wrappers over @tanstack/react-query v5 so a screen never touches react-query
 *  directly and every error is an `ApiError`. Keys come from `qk` (query-keys.ts). */

import { useCallback, useMemo } from "react"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import { ApiError, toApiError } from "@/gateways/api/http"

/** Never retry a 4xx (the request itself is wrong) or a network failure twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : 0
  if (status >= 400 && status < 500) return false
  return failureCount < 1
}

export type UseApiOptions<T> = {
  /** false = do not fetch yet (e.g. while an id is unknown). Default true. */
  enabled?: boolean
  /** Poll interval in ms, or a function of the current data returning ms or false
   *  (e.g. `d => d?.status === "building" ? 5000 : false`). Stops on unmount. */
  poll?: number | false | ((data: T | undefined) => number | false)
  /** Keep showing the previous key's data while the new key loads (pagination, version
   *  switch). Default false: a new key shows the loading skeleton. */
  keepPrevious?: boolean
  /** How long data counts as fresh, in ms. Default 30 s (set on the QueryClient). */
  staleMs?: number
}

/** What `useApi` returns. Pass it straight to `<AsyncView q={...}>`. */
export type ApiQuery<T> = {
  data: T | undefined
  /** 'loading' only before the first data for this key; refetches keep 'success'. */
  status: "loading" | "error" | "success"
  /** A background refetch (poll, focus, invalidation) is in flight. */
  refreshing: boolean
  error: ApiError | null
  /** Refetch now (the Retry button). */
  retry: () => void
}

/** Read through the shared cache.
 *
 *  `fn` receives the query's AbortSignal: pass it as the gateway's last argument so a key
 *  change or unmount cancels the request and stale responses can never land.
 *
 *  @example
 *  const q = useApi(qk.mastery(docId), (signal) => fetchMastery(docId, signal))
 */
export function useApi<T>(
  key: QueryKey,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: UseApiOptions<T> = {},
): ApiQuery<T> {
  const { enabled = true, poll, keepPrevious = false, staleMs } = opts
  const q = useQuery<T, ApiError>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      try {
        return await fn(signal)
      } catch (err) {
        // An abort is react-query's own cancellation; let it through untouched.
        if (err instanceof DOMException && err.name === "AbortError") throw err
        throw toApiError(err)
      }
    },
    enabled,
    staleTime: staleMs,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    refetchInterval:
      typeof poll === "function" ? (query) => poll(query.state.data as T | undefined) : poll ?? false,
  })
  const { refetch } = q
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])
  return {
    data: q.data,
    status: q.status === "pending" ? "loading" : q.status,
    refreshing: q.isFetching && q.status !== "pending",
    error: q.error ?? null,
    retry,
  }
}

export type UseApiMutationOptions<V, R> = {
  /** Keys (or roots) to invalidate after success, or a function of (vars, result). */
  invalidates?: QueryKey[] | ((vars: V, result: R) => QueryKey[])
  /** Serialise mutations sharing this id (they run one at a time, in order), e.g.
   *  `"sit:" + sittingKey` for per-keystroke answer saves. */
  serialKey?: string
  /** Retries on failure (4xx never retry). Default 0. */
  retry?: number
  onSuccess?: (result: R, vars: V) => void
  onError?: (error: ApiError, vars: V) => void
}

/** What `useApiMutation` returns. */
export type ApiMutation<V, R> = {
  /** Run and await; throws ApiError on failure (use in handlers that need the result). */
  run: (vars: V) => Promise<R>
  /** Run without awaiting; failure lands in `error` (use for buttons). */
  fire: (vars: V) => void
  pending: boolean
  error: ApiError | null
  data: R | undefined
  /** Clear `error`/`data` (e.g. when the card changes). */
  reset: () => void
}

/** A write. On success it invalidates `invalidates`, then calls `onSuccess`. Never
 *  advance UI before success: render `error` as "Not saved · Retry" instead.
 *
 *  @example
 *  const grade = useApiMutation(
 *    (v: { key: string; g: ReviewGrade }) => submitReviewGrade(v.key, v.g, docId),
 *    { invalidates: GRADE_INVALIDATES, onSuccess: () => next() },
 *  )
 */
export function useApiMutation<V, R>(
  fn: (vars: V) => Promise<R>,
  opts: UseApiMutationOptions<V, R> = {},
): ApiMutation<V, R> {
  const client = useQueryClient()
  const { invalidates, serialKey, retry = 0, onSuccess, onError } = opts
  const m = useMutation<R, ApiError, V>({
    mutationFn: async (vars) => {
      try {
        return await fn(vars)
      } catch (err) {
        throw toApiError(err)
      }
    },
    scope: serialKey ? { id: serialKey } : undefined,
    retry: (count, err) => count < retry && shouldRetry(0, err),
    onSuccess: (result, vars) => {
      // Invalidation is started, not awaited: the caller advances as soon as the write
      // landed, and the refetches settle in the background.
      const keys = typeof invalidates === "function" ? invalidates(vars, result) : invalidates ?? []
      for (const queryKey of keys) void client.invalidateQueries({ queryKey })
      onSuccess?.(result, vars)
    },
    onError: (err, vars) => onError?.(err, vars),
  })
  const { mutateAsync, mutate, reset } = m
  return useMemo(
    () => ({
      run: (vars: V) => mutateAsync(vars),
      fire: (vars: V) => mutate(vars),
      pending: m.isPending,
      error: m.error ?? null,
      data: m.data,
      reset,
    }),
    [mutateAsync, mutate, reset, m.isPending, m.error, m.data],
  )
}

/** Imperative cache access for the rare case a hook can't cover (e.g. invalidating from
 *  a non-mutation event such as a websocket). Prefer `useApiMutation({invalidates})`. */
export function useInvalidate(): (...keys: QueryKey[]) => Promise<void> {
  const client = useQueryClient()
  return useCallback(
    async (...keys: QueryKey[]) => {
      await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })))
    },
    [client],
  )
}
