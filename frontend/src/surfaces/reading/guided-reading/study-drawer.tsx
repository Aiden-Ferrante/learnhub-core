"use client"

import { X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ReviewPanel } from "@/surfaces/studying"
import { ChapterWalk } from "@/surfaces/studying"
import { LockInPanel } from "@/surfaces/studying"
import { LessonPanel } from "@/surfaces/studying"
import { AudiobookPanel } from "@/surfaces/reading/audiobook-panel"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { DRAWER_TITLES, type StudyDrawer } from "./lib"

/** The study drawer: review / walk / lock-in / tutor / listen over the same reading
 *  surface. Anchored absolute inside the surface root (a fixed drawer would open
 *  under the app's nav shell). Each panel's grades are mutations that invalidate mastery, the
 *  queues and the chapter path themselves, so the drawer passes no refresh callbacks. */
export function StudyDrawerPanel({
  drawer,
  title,
  chapterKey,
  docId,
  tree,
  onClose,
}: {
  drawer: Exclude<StudyDrawer, null>
  title: string
  chapterKey: string | null
  docId: string
  tree: LearnTreeNode[]
  onClose: () => void
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-40 flex w-[min(30rem,95vw)] flex-col border-l bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="text-xs font-medium text-muted-foreground">
          {DRAWER_TITLES[drawer]} · {title}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close drawer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {drawer === "review" && chapterKey && (
          <ReviewPanel scope={chapterKey} docId={docId} />
        )}
        {drawer === "walk" && (
<ChapterWalk scope={chapterKey} docId={docId} tree={tree} />
        )}
        {drawer === "lockin" && <LockInPanel scope={chapterKey} docId={docId} />}
        {drawer === "tutor" && <LessonPanel scope={chapterKey} docId={docId} />}
        {drawer === "listen" && <AudiobookPanel scope={chapterKey} docId={docId} />}
      </div>
    </div>
  )
}
