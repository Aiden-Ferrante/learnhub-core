import { ApiError } from "@/gateways/api/http"

/** Several learn reads answer 2xx with `{ error }` instead of failing. Turn that envelope
 *  into a thrown ApiError so useApi / AsyncView show it like any other failure. */
export function orThrow<T extends { error?: string }>(data: T): T {
  if (data.error) throw new ApiError(500, data.error)
  return data
}

/** Raw document titles can be whole filenames ("Title -- Author -- year -- isbn…"); keep the
 *  part before the first separator so one line stays one line. */
export function shortTitle(title: string): string {
  return title.split(/\s+--\s+|[:–—]/)[0].trim().slice(0, 40)
}
