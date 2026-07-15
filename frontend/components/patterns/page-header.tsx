import { cn } from "@/lib/utils"

/** Title + one-line purpose + right-aligned actions — the top of every screen. */
export function PageHeader({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex items-center gap-3">
        {icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 text-brand">
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold leading-tight tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
