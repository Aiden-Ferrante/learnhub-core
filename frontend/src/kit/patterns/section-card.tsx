import { cn } from "@/kit/lib/utils"

/** The standard content card: border-only surface, optional titled header row.
 *  `elevated` adds shadow — reserve it for overlays/hero surfaces, not grids. */
export function SectionCard({
  title,
  description,
  actions,
  elevated = false,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode
  description?: string
  actions?: React.ReactNode
  elevated?: boolean
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn("rounded-lg border bg-card", elevated && "shadow-lg", className)}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}
