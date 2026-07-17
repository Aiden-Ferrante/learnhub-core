"use client"

import { cn } from "@/kit/lib/utils"

/** One row in a clickable list: leading icon, title + description, trailing detail.
 *  Renders a <button> when onClick is given, a plain row otherwise. */
export function ListRow({
  leading,
  title,
  description,
  trailing,
  onClick,
  className,
}: {
  leading?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  trailing?: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  const body = (
    <>
      {leading && <span className="shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {description && (
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      {trailing && <span className="shrink-0 text-xs text-muted-foreground">{trailing}</span>}
    </>
  )
  const classes = cn(
    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left",
    onClick && "transition-colors hover:border-brand/50 hover:bg-brand/5",
    className,
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  ) : (
    <div className={classes}>{body}</div>
  )
}
