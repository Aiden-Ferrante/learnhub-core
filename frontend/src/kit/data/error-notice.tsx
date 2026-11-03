"use client"

import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { cn } from "@/kit/lib/utils"
import { toApiError, type ApiError } from "@/gateways/api/http"

/** The sentence a person sees for a failed request: the service-down and not-found cases
 *  get fixed words, everything else shows the server's own message. */
export function errorMessage(error: ApiError | Error | unknown): string {
  const e = toApiError(error)
  if (e.status === 0) return e.message || "Couldn't reach the server"
  if (e.status === 401) return "Your session ended. Sign in again."
  if (e.status === 404) return e.message && e.message !== "Not Found" ? e.message : "Not found"
  if (e.status === 502 || e.status === 503 || e.status === 504) return "The learn service is down. Try again in a moment."
  return e.message || "Something went wrong"
}

/** A failed request, said plainly, with a Retry. `compact` is the one-line inline form for
 *  a card or a row ("Not saved · Retry"); the default is a block for a whole panel.
 *
 *  @example <ErrorNotice error={q.error} onRetry={q.retry} />
 *  @example <ErrorNotice compact title="Not saved" error={grade.error} onRetry={() => grade.fire(v)} />
 */
export function ErrorNotice({
  error,
  onRetry,
  title,
  compact = false,
  className,
}: {
  error: ApiError | Error | unknown
  /** Omit to render no Retry button (e.g. a 404 nobody can retry into existence). */
  onRetry?: () => void
  /** Short lead, e.g. "Couldn't load your library" or "Not saved". */
  title?: string
  compact?: boolean
  className?: string
}) {
  const message = errorMessage(error)
  if (compact) {
    return (
      <p role="alert" className={cn("flex flex-wrap items-center gap-x-1.5 text-meta text-ink-danger", className)}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{title ?? message}</span>
        {title && <span className="text-muted-foreground">· {message}</span>}
        {onRetry && (
          <>
            <span aria-hidden className="text-muted-foreground">·</span>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-meta text-ink-accent" onClick={onRetry}>
              Retry
            </Button>
          </>
        )}
      </p>
    )
  }
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 px-6 py-8 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-6 w-6 text-ink-danger" aria-hidden />
      <div className="text-body font-medium text-foreground">{title ?? "Couldn't load this"}</div>
      <p className="max-w-sm text-meta text-muted-foreground">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="mt-1 gap-1.5" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </div>
  )
}
