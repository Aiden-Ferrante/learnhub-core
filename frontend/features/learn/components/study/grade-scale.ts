import type { ReviewGrade } from "@/features/learn/api/review"

/** THE recall grade scale (1=Again … 4=Easy) with its button styling — the review panel and
 *  the concept detail's inline grader render the same scale, so it lives once. */
export const GRADES: { grade: ReviewGrade; label: string; cls: string }[] = [
  { grade: 1, label: "Again", cls: "border-rose-500/40 text-rose-400 hover:bg-rose-500/10" },
  { grade: 2, label: "Hard", cls: "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" },
  { grade: 3, label: "Good", cls: "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" },
  { grade: 4, label: "Easy", cls: "border-blue-500/40 text-blue-400 hover:bg-blue-500/10" },
]
