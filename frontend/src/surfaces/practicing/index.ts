/** Practicing — exam packs: chapters of one textbook built into Learn plus an exam pool,
 *  with their own Today / Learn / Exam / Results tabs. The old practice session, exam
 *  mode and match game were deleted in v0.25.0 (docs/ui-spec.md §1); packs replace them.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  Depends on: reading (the one renderer + prose prefs), studying (grade scale),
 *  gateways/, kit/. */

export { PacksHome } from "@/surfaces/practicing/packs-home"
export { PackView, PACK_TABS, parsePackTab, type PackTab } from "@/surfaces/practicing/pack-view"
