"use client"

import type { ConceptQuizResult } from "@/features/learn/api/quiz"
import { cn } from "@/lib/utils"

/** The MCQ choice list — numbered kbd chips, correct/picked/dimmed coloring after the
 *  result lands. One rendering for every concept-quiz surface (panel + quick check),
 *  so the answer-state palette can't drift between them. */
export function QuizChoiceList({
  choices,
  picked,
  result,
  onPick,
  size = "md",
}: {
  choices: string[]
  picked: number | null
  result: ConceptQuizResult | null
  onPick: (i: number) => void
  size?: "sm" | "md"
}) {
  return (
    <div className={cn("grid", size === "sm" ? "gap-1.5" : "gap-2")}>
      {choices.map((c, i) => {
        const isCorrect = result && c === result.expected
        const isPicked = picked === i
        const cls = !result
          ? "border-border hover:border-brand/50"
          : isCorrect
            ? "border-emerald-500/60 bg-emerald-500/10"
            : isPicked
              ? "border-rose-500/60 bg-rose-500/10"
              : "border-border opacity-60"
        return (
          <button
            key={i}
            type="button"
            disabled={!!result}
            onClick={() => onPick(i)}
            className={cn(
              "flex items-center gap-2 border text-left transition-colors",
              size === "sm" ? "rounded-md px-2.5 py-1.5 text-xs" : "rounded-lg px-3 py-2 text-sm",
              cls,
            )}
          >
            <kbd className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{i + 1}</kbd>
            <span>{c}</span>
          </button>
        )
      })}
    </div>
  )
}
