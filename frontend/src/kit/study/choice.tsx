"use client"

import type React from "react"
import { cn } from "@/kit/lib/utils"

const LETTERS = "ABCDEFGHIJ"

/** How a choice is marked: idle, picked by the learner, or marked right / wrong. */
export type ChoiceState = "idle" | "selected" | "right" | "wrong"

/** One pick-one answer (.study-choice with its .study-letter). `index` gives the letter
 *  (0 → A). Pass `disabled` once the question is answered so it can't be re-picked.
 *
 *  @example
 *  {q.choices.map((c, i) => (
 *    <Choice key={i} index={i} state={pick === i ? "selected" : "idle"} onClick={() => setPick(i)}>{c}</Choice>
 *  ))}
 */
export function Choice({
  index,
  state = "idle",
  disabled,
  onClick,
  children,
  className,
}: {
  index: number
  state?: ChoiceState
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        "study-choice text-body",
        state === "selected" && "sel",
        state === "right" && "right",
        state === "wrong" && "wrong",
        className,
      )}
      aria-pressed={state === "selected"}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="study-letter text-micro font-semibold">{LETTERS[index] ?? index + 1}</span>
      <span className="min-w-0">{children}</span>
    </button>
  )
}
