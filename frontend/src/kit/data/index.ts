/** kit/data — the data contract every surface uses (docs/ui-spec.md §5).
 *
 *  Reads:   useApi(qk.x(...), (signal) => gatewayFn(..., signal), opts?)
 *  Writes:  useApiMutation(fn, { invalidates: [...] })
 *  Render:  <AsyncView q={query}>{(data) => ...}</AsyncView>, <ErrorNotice error onRetry />
 *  Errors are always `ApiError` (from @/gateways/api/http). */

export { qk, roots, GRADE_INVALIDATES, PACK_INVALIDATES } from "@/kit/data/query-keys"
export {
  useApi,
  useApiMutation,
  useInvalidate,
  shouldRetry,
  type ApiQuery,
  type ApiMutation,
  type UseApiOptions,
  type UseApiMutationOptions,
} from "@/kit/data/use-api"
export { AsyncView } from "@/kit/data/async-view"
export { ErrorNotice, errorMessage } from "@/kit/data/error-notice"
export { QueryProvider, makeQueryClient } from "@/kit/data/query-provider"
export { ApiError, isApiError } from "@/gateways/api/http"
