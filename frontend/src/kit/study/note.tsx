import type React from "react"
import { cn } from "@/kit/lib/utils"

/** THE callout on study screens (.study-note): an accent rule for information, a warn
 *  rule (`tone="warn"`) for something that needs the learner's attention. Not for request
 *  failures: those are ErrorNotice (kit/data).
 *
 *  @example <Note tone="warn">This paper is 3 short: the pool ran out of unseen questions.</Note>
 */
export function Note({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warn"
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn("study-note text-body", tone === "warn" && "warn", className)}>{children}</div>
}
