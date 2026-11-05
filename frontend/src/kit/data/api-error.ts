/** ApiError — the one error type every learn API call throws, and its helpers.
 *
 *  Product-blind: it knows HTTP statuses and FastAPI's 422 shape, nothing about any screen.
 *  It lives in kit so kit/data (AsyncView, ErrorNotice, useApi) can name it without
 *  importing up into gateways; gateways/api/http.ts throws it and re-exports it. */

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
