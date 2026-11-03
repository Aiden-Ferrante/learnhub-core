"use client"

/** Data hooks for the course editor: the outline, the chapter list, each chapter's
 *  material, the stale-chapter cue and the unplaced blocks, plus every write. Views stay
 *  presentational; every read and write lives here. */

import {
  fetchSectionMaterial,
  fetchStaleSections,
  fetchUnplacedBlocks,
  moveBlocks,
  removeBlocks,
  revertBlock,
  saveBlock,
  saveOutline,
  type EditTarget,
  type OutlineSection,
} from "@/gateways/api/editing"
import { fetchOutline, fetchTocTree } from "@/gateways/api/outline"
import { useMemo } from "react"
import { qk, roots, useApi, useApiMutation, type ApiQuery } from "@/kit/data"

/** A reshaped outline moves chapters, their numbers and what is filed under them. */
const OUTLINE_INVALIDATES = [
  roots.outline,
  roots.tocTree,
  roots.chapters,
  roots.unplacedBlocks,
  roots.sectionMaterial,
  roots.staleSections,
]

/** Re-filing or dropping blocks changes what each chapter holds. */
const BLOCKS_INVALIDATES = [roots.unplacedBlocks, roots.sectionMaterial, roots.sectionContent, roots.staleSections]

/** A text edit changes what the reader shows and marks its chapter's concepts stale. */
const TEXT_INVALIDATES = [roots.sectionMaterial, roots.staleSections, roots.sectionContent, roots.documentMarkdown]

/** The stored outline as the editor edits it: a flat list with depth. It shares the raw
 *  `qk.outline` entry with the readers and breadcrumbs (one query function per key, or the
 *  cache would hand one caller another's shape), and reshapes it here. */
export function useOutlineSections(docId: string): ApiQuery<OutlineSection[]> {
  const q = useApi(qk.outline(docId), (signal) => fetchOutline(docId, signal))
  const data = useMemo(
    () =>
      q.data
        ? (q.data.outline ?? []).map((e) => ({
            sectionKey: e.sectionKey ?? undefined,
            title: e.title ?? "",
            depth: e.listDepth ?? 0,
          }))
        : undefined,
    [q.data],
  )
  return { ...q, data }
}

export function useTocTree(docId: string) {
  return useApi(qk.tocTree(docId), (signal) => fetchTocTree(docId, signal))
}

export function useStaleSections(docId: string) {
  return useApi(qk.staleSections(docId), (signal) => fetchStaleSections(docId, signal))
}

export function useSectionMaterial(docId: string, scope: string | null) {
  return useApi(qk.sectionMaterial(docId, scope ?? ""), (signal) => fetchSectionMaterial(docId, scope!, signal), {
    enabled: !!scope,
  })
}

export function useUnplacedBlocks(docId: string) {
  return useApi(qk.unplacedBlocks(docId), (signal) => fetchUnplacedBlocks(docId, signal))
}

export function useSaveOutline(docId: string, onSuccess: () => void) {
  return useApiMutation((rows: OutlineSection[]) => saveOutline(docId, rows), {
    invalidates: OUTLINE_INVALIDATES,
    onSuccess,
  })
}

export type BlockAction = { kind: "move"; keys: string[]; sectionKey: string } | { kind: "remove"; keys: string[] }

export function useBlockAction(docId: string, onSuccess: () => void) {
  return useApiMutation(
    (a: BlockAction): Promise<unknown> =>
      a.kind === "move" ? moveBlocks(docId, a.keys, a.sectionKey) : removeBlocks(docId, a.keys),
    { invalidates: BLOCKS_INVALIDATES, onSuccess },
  )
}

export type TextEdit =
  | { kind: "save"; blockKey: string; markdown: string; target: EditTarget }
  | { kind: "revert"; blockKey: string }

export function useTextEdit(docId: string, onSuccess: () => void) {
  return useApiMutation(
    (e: TextEdit): Promise<unknown> =>
      e.kind === "save" ? saveBlock(docId, e.blockKey, e.markdown, e.target) : revertBlock(docId, e.blockKey),
    { invalidates: TEXT_INVALIDATES, onSuccess },
  )
}
