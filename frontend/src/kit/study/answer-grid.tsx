"use client"

import { cn } from "@/kit/lib/utils"

/** A cell's mark: answered (while sitting), ok / no (marked), pending (awaiting a self-mark). */
export type AnswerCellState = "empty" | "answered" | "ok" | "no" | "pending"

export type AnswerCell = {
  key: string
  /** What the cell shows; defaults to its 1-based number. */
  label?: string
  state?: AnswerCellState
  flagged?: boolean
}

/** The question map of a sitting (.study-grid / .study-cell): one numbered cell per
 *  question, the current one ringed, flagged ones dotted. Click jumps to a question.
 *
 *  @example
 *  <AnswerGrid label="Questions" current={at} onSelect={setAt}
 *    cells={qs.map((q) => ({ key: q.key, state: answers[q.key] ? "answered" : "empty", flagged: answers[q.key]?.flag }))} />
 */
export function AnswerGrid({
  cells,
  current,
  onSelect,
  label,
  className,
}: {
  cells: AnswerCell[]
  current?: number
  onSelect?: (index: number) => void
  label: string
  className?: string
}) {
  return (
    <div className={cn("study-grid", className)} role="group" aria-label={label}>
      {cells.map((c, i) => (
        <button
          key={c.key}
          type="button"
          aria-current={i === current ? "step" : undefined}
          aria-label={`Question ${i + 1}${c.flagged ? ", flagged" : ""}${c.state && c.state !== "empty" ? `, ${c.state}` : ""}`}
          onClick={onSelect ? () => onSelect(i) : undefined}
          className={cn(
            "study-cell font-mono text-micro",
            c.state === "answered" && "ans",
            c.state === "ok" && "ok",
            c.state === "no" && "no",
            c.state === "pending" && "pending",
            c.flagged && "flag",
            i === current && "cur",
          )}
        >
          {c.label ?? i + 1}
        </button>
      ))}
    </div>
  )
}
