/** Concepts — the concept layer on screen: outline tree, concept cards + detail.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  Owns the concepts screen and the shared concept display primitives (markdown,
 *  kind palette, mastery dot, per-section panel) other surfaces embed.
 *  Depends on: studying (quiz-in-detail), reading (figures/math), gateways/, kit/. */

export { ConceptsView } from "@/surfaces/concepts/concepts-view"
export { ConceptMarkdown } from "@/surfaces/concepts/concept-markdown"
export { ConceptMasteryDot } from "@/surfaces/concepts/concept-mastery-dot"
export { SectionConceptsPanel } from "@/surfaces/concepts/section-concepts-panel"
export { KIND_BADGE, KIND_CHIP } from "@/surfaces/concepts/kind-palette"
