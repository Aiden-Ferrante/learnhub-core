"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { AsyncView, ErrorNotice } from "@/kit/data"
import { SkeletonRow } from "@/kit/patterns/skeletons"
import { Sheet } from "@/kit/study"
import { deleteGroup, moveGroup } from "@/surfaces/library/course-groups"
import { GroupSidebar } from "@/surfaces/library/group-sidebar"
import type { CourseGroupsApi } from "@/surfaces/library/use-course-groups"

// Group-sidebar width bounds (px): wide enough for nested group names, never so wide the
// course grid collapses. A device preference, so it lives in localStorage.
const SIDEBAR_WIDTH_KEY = "learnhub_group_sidebar_width"
const SIDEBAR_DEFAULT = 224
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 440

/** The shelf's left column: the group tree (loaded through the cache, with its own error
 *  and Retry), a failed-save line, and the right-edge drag handle that resizes it. */
export function GroupPanel({
  groups,
  totalCount,
  selectedGroupId,
  onSelect,
  onNewGroup,
  onRenameGroup,
}: {
  groups: CourseGroupsApi
  totalCount: number
  selectedGroupId: string | null
  onSelect: (groupId: string | null) => void
  onNewGroup: () => void
  onRenameGroup: (groupId: string, currentName: string) => void
}) {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  useEffect(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) setWidth(saved)
  }, [])
  const resized = (e: { clientX: number }) => {
    const r = resizeStart.current
    return r ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, r.width + e.clientX - r.x)) : width
  }

  return (
    <div
      className="relative lg:w-[var(--gs-w)] lg:shrink-0"
      // The width is dynamic geometry (a drag), the sanctioned inline style.
      style={{ "--gs-w": `${width}px` } as React.CSSProperties}
    >
      <div className="flex flex-col gap-2 lg:sticky lg:top-[calc(var(--fleet-header-h)_+_1rem)] lg:h-[520px]">
        <AsyncView
          q={groups.query}
          errorTitle="Couldn't load your groups"
          skeleton={
            <Sheet title="Groups">
              <SkeletonRow />
            </Sheet>
          }
        >
          {() => (
            <GroupSidebar
              tree={groups.tree}
              selectedGroupId={selectedGroupId}
              totalCount={totalCount}
              courseCounts={groups.counts}
              canEdit={groups.ready}
              onSelect={onSelect}
              onNewGroup={onNewGroup}
              onRenameGroup={onRenameGroup}
              onDeleteGroup={(id) => {
                groups.update((s) => deleteGroup(s, id))
                if (selectedGroupId === id) onSelect(null)
              }}
              onMoveGroup={(dragId, target) => groups.update((s) => moveGroup(s, dragId, target))}
            />
          )}
        </AsyncView>
        {groups.saveError && (
          <ErrorNotice compact title="Not saved" error={groups.saveError} onRetry={groups.retrySave} />
        )}
      </div>
      {/* Right-border drag handle — the sidebar's only resizable edge. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize groups sidebar"
        className="group absolute -right-2.5 top-0 hidden h-full w-2.5 cursor-col-resize touch-none lg:block"
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          resizeStart.current = { x: e.clientX, width }
        }}
        onPointerMove={(e) => {
          if (resizeStart.current) setWidth(resized(e))
        }}
        onPointerUp={(e) => {
          if (!resizeStart.current) return
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(resized(e)))
          resizeStart.current = null
        }}
      >
        <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-brand/60" />
      </div>
    </div>
  )
}
