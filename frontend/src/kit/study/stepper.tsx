"use client"

import type React from "react"
import { cn } from "@/kit/lib/utils"

export type StepItem<T extends string> = {
  id: T
  label: React.ReactNode
  /** Second line under the label (status, score). */
  sub?: React.ReactNode
  disabled?: boolean
}

/** A row of steps (.study-stepper / .study-step), e.g. a pack's chapters. The current
 *  step is outlined in accent; disabled steps are not reachable yet. Scrolls sideways.
 *
 *  @example
 *  <Stepper label="Chapters" current={unitKey} onSelect={setUnitKey}
 *    steps={units.map((u) => ({ id: u.key, label: u.title, sub: u.status, disabled: u.status !== "ready" }))} />
 */
export function Stepper<T extends string>({
  steps,
  current,
  onSelect,
  label,
  className,
}: {
  steps: StepItem<T>[]
  current: T | null
  onSelect: (id: T) => void
  label: string
  className?: string
}) {
  return (
    <nav className={cn("study-stepper", className)} aria-label={label}>
      {steps.map((s) => (
        <button
          key={s.id}
          type="button"
          className="study-step"
          disabled={s.disabled}
          aria-current={s.id === current}
          onClick={() => onSelect(s.id)}
        >
          <div className="truncate text-meta font-medium">{s.label}</div>
          {s.sub != null && <div className="truncate text-micro text-muted-foreground">{s.sub}</div>}
        </button>
      ))}
    </nav>
  )
}
