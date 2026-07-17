/** THE concept-kind palette — token-based (`--kind-*` in globals.css, themed for dark and
 *  paper) with one variant per shape. Three hand-rolled copies had diverged (definition was
 *  blue in one, sky in another, the token in a third); every kind-colored surface now reads
 *  from here so the mapping cannot drift again. */

/** Solid badge: kind label chips on cards, rows, and the review panel. */
export const KIND_BADGE: Record<string, string> = {
  definition: "bg-kind-definition/15 text-kind-definition",
  theorem: "bg-kind-theorem/15 text-kind-theorem",
  principle: "bg-kind-principle/15 text-kind-principle",
  result: "bg-kind-result/15 text-kind-result",
  method: "bg-kind-method/15 text-kind-method",
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
  definition: "text-kind-definition border-kind-definition/30 bg-kind-definition/10",
  theorem: "text-kind-theorem border-kind-theorem/30 bg-kind-theorem/10",
  principle: "text-kind-principle border-kind-principle/30 bg-kind-principle/10",
  result: "text-kind-result border-kind-result/30 bg-kind-result/10",
  method: "text-kind-method border-kind-method/30 bg-kind-method/10",
}
