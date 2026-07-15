"use client"

import { useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Layers,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { GroupTreeNode } from "@/features/learn/lib/course-groups"

type GroupSidebarProps = {
  tree: GroupTreeNode[]
  selectedGroupId: string | null
  totalCount: number
  /** groupId → number of courses tagged into it (including descendants). */
  courseCounts: Record<string, number>
  onSelect: (groupId: string | null) => void
  onNewGroup: () => void
  onRenameGroup: (groupId: string, currentName: string) => void
  onDeleteGroup: (groupId: string) => void
}

function GroupRow({
  node,
  depth,
  selectedGroupId,
  courseCounts,
  expanded,
  onToggleExpand,
  onSelect,
  onRenameGroup,
  onDeleteGroup,
}: {
  node: GroupTreeNode
  depth: number
  selectedGroupId: string | null
  courseCounts: Record<string, number>
  expanded: Set<string>
  onToggleExpand: (id: string) => void
  onSelect: (groupId: string | null) => void
  onRenameGroup: (groupId: string, currentName: string) => void
  onDeleteGroup: (groupId: string) => void
}) {
  const { group } = node
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(group.id)
  const isSelected = group.id === selectedGroupId
  const count = courseCounts[group.id] ?? 0

  return (
    <li className="list-none">
      <div
        className={cn(
          "group/row flex items-center gap-1 rounded-md py-1 pr-1 text-sm",
          isSelected ? "bg-brand/15 text-foreground" : "hover:bg-muted/60",
        )}
        style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(group.id)
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left leading-snug"
          onClick={() => onSelect(group.id)}
        >
          <FolderTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{group.name}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover/row:opacity-100 data-[state=open]:opacity-100"
              aria-label="Group actions"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => onRenameGroup(group.id, group.name)}>
              <Pencil className="h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDeleteGroup(group.id)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasChildren && isExpanded ? (
        <ul>
          {node.children.map((child) => (
            <GroupRow
              key={child.group.id}
              node={child}
              depth={depth + 1}
              selectedGroupId={selectedGroupId}
              courseCounts={courseCounts}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onRenameGroup={onRenameGroup}
              onDeleteGroup={onDeleteGroup}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function GroupSidebar({
  tree,
  selectedGroupId,
  totalCount,
  courseCounts,
  onSelect,
  onNewGroup,
  onRenameGroup,
  onDeleteGroup,
}: GroupSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const handleToggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Groups</span>
        <button
          type="button"
          onClick={onNewGroup}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>
      <ScrollArea className="flex-1 px-2 py-2">
        <ul>
          <li className="list-none">
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md py-1 pl-[0.25rem] pr-1 text-sm",
                selectedGroupId === null
                  ? "bg-brand/15 text-foreground"
                  : "hover:bg-muted/60",
              )}
            >
              <span className="w-4 shrink-0" />
              <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">All courses</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                {totalCount}
              </span>
            </button>
          </li>
          {tree.map((node) => (
            <GroupRow
              key={node.group.id}
              node={node}
              depth={0}
              selectedGroupId={selectedGroupId}
              courseCounts={courseCounts}
              expanded={expanded}
              onToggleExpand={handleToggleExpand}
              onSelect={onSelect}
              onRenameGroup={onRenameGroup}
              onDeleteGroup={onDeleteGroup}
            />
          ))}
        </ul>
        {tree.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No groups yet. Create one to organize your courses.
          </p>
        )}
      </ScrollArea>
    </div>
  )
}
