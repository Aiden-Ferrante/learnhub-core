/** THE concept-kind palette — token-based (`--kind-*` in globals.css, themed for dark and
 *  paper) with one variant per shape. Three hand-rolled copies had diverged (definition was
 *  blue in one, sky in another, the token in a third); every kind-colored surface now reads
 *  from here so the mapping cannot drift again.
 *
 *  The hue lives in the wash and border only. The word is plain foreground: a kind fill
 *  is not safe as text (spec §4), and there are no kind ink tokens. */

/** Solid badge: kind label chips on cards, rows, and the review panel. */
export const KIND_BADGE: Record<string, string> = {
  definition: "bg-kind-definition/15 text-foreground",
  theorem: "bg-kind-theorem/15 text-foreground",
  principle: "bg-kind-principle/15 text-foreground",
  result: "bg-kind-result/15 text-foreground",
  method: "bg-kind-method/15 text-foreground",
}

/** Left-edge accent — tells concept types apart while scanning a list. */
export const KIND_BORDER: Record<string, string> = {
  definition: "border-l-kind-definition/60",
  theorem: "border-l-kind-theorem/60",
  principle: "border-l-kind-principle/60",
  result: "border-l-kind-result/60",
  method: "border-l-kind-method/60",
}

/** Outlined chip: rounded-full concept pills (briefing cloud, popover, recall rows). */
export const KIND_CHIP: Record<string, string> = {
  definition: "text-foreground border-kind-definition/40 bg-kind-definition/15",
  theorem: "text-foreground border-kind-theorem/40 bg-kind-theorem/15",
  principle: "text-foreground border-kind-principle/40 bg-kind-principle/15",
  result: "text-foreground border-kind-result/40 bg-kind-result/15",
  method: "text-foreground border-kind-method/40 bg-kind-method/15",
}
