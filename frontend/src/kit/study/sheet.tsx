import type React from "react"
import { cn } from "@/kit/lib/utils"

/** THE card on study screens (.study-sheet): one working surface. Replaces SectionCard
 *  and hand-rolled `rounded border bg-card` boxes. Optional header: title, description,
 *  actions (right-aligned). `as` picks the element (section by default, article for a
 *  question card).
 *
 *  @example
 *  <Sheet title="Due today" description="12 cards" actions={<Button size="sm">Start</Button>}>…</Sheet>
 */
export function Sheet({
  title,
  description,
  actions,
  as: Tag = "section",
  children,
  className,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  as?: "section" | "article" | "div" | "aside"
  children?: React.ReactNode
  className?: string
}) {
  const hasHeader = title != null || description != null || actions != null
  return (
    <Tag className={cn("study-sheet flex flex-col gap-3", className)}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title != null && <h2 className="text-title font-medium text-foreground">{title}</h2>}
            {description != null && <p className="text-meta text-muted-foreground">{description}</p>}
          </div>
          {actions != null && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  )
}
