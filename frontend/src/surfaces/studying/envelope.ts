import { ApiError } from "@/kit/data"

/** Some learn routes answer 200 with `{ error: "..." }` instead of a non-2xx status. Inside
 *  useApi/useApiMutation that body would count as success, so every studying read and
 *  write goes through this: an error envelope becomes a thrown ApiError, which AsyncView
 *  and ErrorNotice then render with a Retry like any other failure. */
export async function unwrap<T extends object>(p: Promise<T>): Promise<T> {
  const res = await p
  const error = (res as { error?: unknown }).error
  if (typeof error === "string" && error) throw new ApiError(200, error, error)
  return res
}
