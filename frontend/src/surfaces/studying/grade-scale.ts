import type { ReviewGrade } from "@/gateways/api/review"

/** THE recall grade scale (1=Again … 4=Easy) with its button styling. The review panel,
 *  skeleton recall, the concept detail's inline grader and the pack view render the same
 *  scale, so it lives once. Fill tokens carry the border and wash, ink tokens the word:
 *  Again = danger, Hard = warn, Good = ok, Easy = accent. */
export const GRADES: { grade: ReviewGrade; label: string; cls: string }[] = [
  { grade: 1, label: "Again", cls: "border-destructive/40 text-ink-danger hover:bg-destructive/10" },
  { grade: 2, label: "Hard", cls: "border-status-due/40 text-ink-warn hover:bg-status-due/10" },
  { grade: 3, label: "Good", cls: "border-status-mastered/40 text-ink-ok hover:bg-status-mastered/10" },
  { grade: 4, label: "Easy", cls: "border-brand/40 text-ink-accent hover:bg-brand/10" },
]
