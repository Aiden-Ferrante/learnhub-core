/** Shared response parsing for the learn API client modules.
 *
 *  Every gateway function ends in `parseJsonResponse(res)`. A non-2xx response throws an
 *  `ApiError` carrying the HTTP status, a readable message and the raw `detail`, so callers
 *  (and `kit/data`'s AsyncView / ErrorNotice) can tell 401, 404, 422 and 503 apart. A 401
 *  anywhere sends the browser to /login (see `onUnauthorized`). */

/** One FastAPI validation problem, as found in a 422 body's `detail` array. */
export type ValidationIssue = { loc?: (string | number)[]; msg?: string; type?: string }

/** A failed learn API request. `status` is the HTTP status (0 = the network failed before a
 *  response), `message` is what to show a person, `detail` is the body's raw `detail` (a
 *  string, or FastAPI's 422 issue array) for code that needs more than the sentence. */
export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/** True for an `ApiError` (or anything shaped like one after a structured clone). */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

/** Normalise anything a request can throw into an `ApiError`: an `ApiError` passes through,
 *  a network failure (fetch's TypeError) becomes status 0 "Couldn't reach the server". */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof TypeError) return new ApiError(0, "Couldn't reach the server", err.message)
  if (err instanceof Error) return new ApiError(0, err.message || 'Something went wrong')
  return new ApiError(0, 'Something went wrong', err)
}

/** Turn FastAPI's 422 `detail` array into one sentence: "field: message; field: message". */
export function formatValidationDetail(detail: ValidationIssue[]): string {
  const parts = detail
    .map((d) => {
      const loc = (d.loc ?? []).filter((p) => p !== 'body' && p !== 'query' && p !== 'path')
      const where = loc.length ? `${loc.join('.')}: ` : ''
      return d.msg ? `${where}${d.msg}` : ''
    })
    .filter(Boolean)
  return parts.length ? parts.join('; ') : 'The request was not valid'
}

function messageFor(res: Response, body: Record<string, unknown>): string {
  const detail = body.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) return formatValidationDetail(detail as ValidationIssue[])
  if (typeof body.error === 'string' && body.error) return body.error
  return res.statusText || 'Learn service request failed'
}

let redirecting = false

/** Send the browser to /login once, keeping where the user was in `from` (the login page
 *  honours a same-origin `from`). No-op on the server and on /login itself. */
export function onUnauthorized(): void {
  if (typeof window === 'undefined' || redirecting) return
  const { pathname, search } = window.location
  if (pathname.startsWith('/login')) return
  redirecting = true
  window.location.assign(`/login?from=${encodeURIComponent(pathname + search)}`)
}

/** Parse a learn API response: the JSON body on 2xx, otherwise throw `ApiError`. A 401
 *  also triggers the global redirect to /login before throwing. */
export async function parseJsonResponse<T>(res: Response): Promise<T & { error?: string }> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: unknown }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized()
    const raw = (body ?? {}) as Record<string, unknown>
    throw new ApiError(res.status, messageFor(res, raw), raw.detail ?? raw.error)
  }
  return body
}
