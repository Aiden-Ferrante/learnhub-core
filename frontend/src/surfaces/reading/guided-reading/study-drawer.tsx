"use client"

import { X } from "lucide-react"
import { ConceptQuizPanel } from "@/surfaces/studying"
import { ReviewPanel } from "@/surfaces/studying"
import { ExamPanel } from "@/surfaces/studying"
import { ChapterWalk } from "@/surfaces/studying"
import { LockInPanel } from "@/surfaces/studying"
import { LessonPanel } from "@/surfaces/studying"
import { AudiobookPanel } from "@/surfaces/reading/audiobook-panel"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { DRAWER_TITLES, type StudyDrawer } from "./lib"

/** The study drawer — quiz / review / exam / walk / lock-in / tutor / listen over the same
 *  reading surface. Anchored absolute inside the surface root (a fixed drawer would open
 *  under the app's nav shell). Cross-concern effects arrive as callbacks: answers refresh
 *  mastery, quiz answers feed the soft gate, exam/walk/lock-in completion reloads the path. */
export function StudyDrawerPanel({
  drawer,
  title,
  chapterKey,
  docId,
  tree,
  onClose,
  onSwitch,
  onRefreshMastery,
  onQuizAnswered,
  onProgress,
}: {
  drawer: Exclude<StudyDrawer, null>
  title: string
  chapterKey: string | null
  docId: string
  tree: LearnTreeNode[]
  onClose: () => void
  onSwitch: (d: Exclude<StudyDrawer, null>) => void
  onRefreshMastery: () => void
  /** Fires per real quiz answer — the quizzes-stage soft gate counts these. */
  onQuizAnswered: () => void
  /** Reload the chapter path (stages written server-side or by the panel itself). */
  onProgress: () => void
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-40 flex w-[min(30rem,95vw)] flex-col border-l bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="text-xs font-medium text-muted-foreground">
          {DRAWER_TITLES[drawer]} · {title}
        </div>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {drawer === "quiz" && (
          <ConceptQuizPanel
            scope={chapterKey}
            docId={docId}
            onAnswered={() => {
              onRefreshMastery()
              // Quizzes soft gate: a real round of retrieval marks the stage.
              onQuizAnswered()
            }}
          />
        )}
        {drawer === "review" && chapterKey && (
          <ReviewPanel scope={chapterKey} docId={docId} onAnswered={onRefreshMastery} />
        )}
        {drawer === "exam" && (
          <ExamPanel
            scope={chapterKey}
            docId={docId}
            onGraded={() => {
              onRefreshMastery()
              onProgress() // exam stage is written server-side on a passing grade
            }}
            onDrillMisses={() => onSwitch("quiz")}
            onLockIn={() => onSwitch("lockin")}
          />
        )}
        {drawer === "walk" && (
          <ChapterWalk
            scope={chapterKey}
            docId={docId}
            tree={tree}
            onAnswered={onRefreshMastery}
            onComplete={onProgress} // walk grades the skeleton stage itself
          />
        )}
        {drawer === "lockin" && <LockInPanel scope={chapterKey} docId={docId} onDone={onProgress} />}
        {drawer === "tutor" && <LessonPanel scope={chapterKey} docId={docId} onAnswered={onRefreshMastery} />}
        {drawer === "listen" && <AudiobookPanel scope={chapterKey} docId={docId} />}
      </div>
    </div>
  )
}
