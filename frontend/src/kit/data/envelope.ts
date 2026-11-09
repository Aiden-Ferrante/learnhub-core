import { ApiError } from "@/kit/data/api-error"

/** Several learn routes answer 2xx with `{ error: "..." }` instead of a non-2xx status.
 *  Inside useApi / useApiMutation that body would count as success, so a surface runs the
 *  gateway's result through one of these: an error envelope becomes a thrown ApiError,
 *  which AsyncView and ErrorNotice then render with a Retry like any other failure.
 *
 *  @example
 *  useApi(qk.mastery(doc), (signal) => fetchMastery(doc, signal).then(orThrow))
 *  useApi(qk.mastery(doc), (signal) => unwrap(fetchMastery(doc, signal)))
 */
export function orThrow<T extends object>(data: T): T {
  const error = (data as { error?: unknown }).error
  if (typeof error === "string" && error) throw new ApiError(200, error, error)
  return data
}

/** `orThrow` for a promise. */
export async function unwrap<T extends object>(p: Promise<T>): Promise<T> {
  return orThrow(await p)
}
