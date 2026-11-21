"use client"

/** The ⋮ menu on each chapter card of the course page (human, 2026-11-21: "a little 3 dots on the
 *  top right that will act as a drop down menu into various tools. For now … extract concept and
 *  settings").
 *
 *  Extract concepts: re-runs concept extraction for this chapter (POST /api/extract?scope=…),
 *  after a confirm, because it replaces the chapter's concepts (review progress carries over to
 *  concepts that come back under the same or a similar name — concepts_extract.py). While it runs
 *  the card shows its progress (one ledger request for all cards); when it ends the concept and review data refresh.
 *  Move to group: chapter groups (chapter-groups.ts).
 *  Settings: a dialog for per-chapter settings; nothing is settable yet. */

import { MoreVertical } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { fetchJobs, startExtraction, type ChapterBuildJob } from "@/gateways/api/pipeline"
import { qk, roots, unwrap, useApi, useApiMutation, useInvalidate } from "@/kit/data"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/kit/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/kit/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/kit/ui/dropdown-menu"

/** Every chapter's extraction job from ONE ledger request (never one per card: that exhausted
 *  the API's pool in v0.31.1). Polls every 3 s while any extraction runs. */
export function useChapterExtractions(docId: string | null | undefined) {
  const invalidate = useInvalidate()
  const q = useApi(qk.jobs(docId ?? ""), (signal) => unwrap(fetchJobs(docId ?? "", signal)), {
    enabled: Boolean(docId),
    poll: (d) => (d?.builds?.some((b) => b.kind === "extract" && (b.status === "running" || b.status === "queued")) ? 3000 : false),
  })
  const byScope = new Map<string, ChapterBuildJob>()
  for (const b of q.data?.builds ?? []) if (b.kind === "extract" && b.scope) byScope.set(b.scope, b)
  const start = useApiMutation((scope: string) => unwrap(startExtraction(scope, docId ?? undefined)), {
    invalidates: [qk.jobs(docId ?? "")],
  })
  // When the last run ends, refresh what extraction changed.
  const running = Array.from(byScope.values()).some((b) => b.status === "running" || b.status === "queued")
  const was = useRef(running)
  useEffect(() => {
    if (was.current && !running) {
      void invalidate(roots.concepts, roots.sectionConcepts, roots.tocTree, roots.reviewQueue, roots.mastery)
    }
    was.current = running
  }, [running, invalidate])
  return { job: (scope: string) => byScope.get(scope), start }
}

/** One line for the card while a run is queued, going, or failed; null otherwise. */
export function extractionLine(j: ChapterBuildJob | undefined): string | null {
  if (!j) return null
  if (j.status === "queued") return "Extraction queued"
  if (j.status === "running") return j.total ? `Extracting concepts · ${j.done ?? 0}/${j.total}` : "Extracting concepts…"
  if (j.status === "error") return "Extraction failed"
  return null
}

export function ChapterCardMenu({
  title,
  running,
  onExtract,
  groups,
  groupId,
  onMove,
  onNewGroup,
}: {
  /** e.g. "Chapter 6 · Unsupervised Learning: Clustering" */
  title: string
  running: boolean
  onExtract: () => void
  /** Chapter groups to move this chapter into (absent → no "Move to group" item). */
  groups?: { id: string; name: string }[]
  groupId?: string | null
  onMove?: (groupId: string | null) => void
  onNewGroup?: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [settings, setSettings] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Tools for ${title}`}
            className="absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={running} onSelect={() => setConfirm(true)}>
            {running ? "Extracting concepts…" : "Extract concepts"}
          </DropdownMenuItem>
          {onMove && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                {(groups ?? []).map((g) => (
                  <DropdownMenuCheckboxItem key={g.id} checked={groupId === g.id} onSelect={() => onMove(g.id)}>
                    {g.name}
                  </DropdownMenuCheckboxItem>
                ))}
                {groupId && <DropdownMenuItem onSelect={() => onMove(null)}>Take out of its group</DropdownMenuItem>}
                {(groups ?? []).length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => onNewGroup?.()}>New group…</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onSelect={() => setSettings(true)}>Settings</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Extract concepts for {title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the chapter’s concepts with a fresh extraction from the book. Review progress carries over to
              concepts that come back under the same or a similar name; a concept that does not come back loses its review
              history. It runs in the background and can take a few minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onExtract}>Extract</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title} · settings</DialogTitle>
            <DialogDescription>Nothing to set for a chapter yet.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  )
}
