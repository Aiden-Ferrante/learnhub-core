"use client"

/** Chapter-group pieces for the course page: the name dialog (new / rename) and a group's
 *  header with its ⋮ menu (rename, move up/down, delete). */

import { ChevronRight, MoreVertical } from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "@/kit/lib/utils"
import { Button } from "@/kit/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/kit/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/kit/ui/dropdown-menu"
import { Input } from "@/kit/ui/input"
import { splitPartName, type ChapterGroup } from "@/surfaces/library/chapter-groups"

export function GroupNameDialog({
  open,
  title,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  title: string
  initial: string
  onClose: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(initial)
  useEffect(() => {
    if (open) setName(initial)
  }, [open, initial])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            onSave(name.trim())
            onClose()
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>For example “Part I · Foundations”.</DialogDescription>
          </DialogHeader>
          <label htmlFor="group-name" className="sr-only">
            Group name
          </label>
          <Input id="group-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function GroupHeader({
  group,
  count,
  studied,
  open,
  onToggle,
  editable,
  first,
  last,
  onRename,
  onMove,
  onDelete,
}: {
  group: ChapterGroup
  count: number
  studied: number
  open: boolean
  onToggle: () => void
  editable: boolean
  first: boolean
  last: boolean
  onRename: () => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  const { label, title } = splitPartName(group.name)
  return (
    <div className="flex items-center gap-2 border-b border-border pb-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        {label && <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-ink-accent">{label}</span>}
        <span className="min-w-0 truncate font-serif text-[20px] font-semibold">{title}</span>
        <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
          {count} chapter{count === 1 ? "" : "s"}
          {count > 0 ? ` · ${studied}% studied` : ""}
        </span>
      </button>
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Group actions for ${group.name}`}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onRename}>Rename…</DropdownMenuItem>
            <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete}>Delete group (keeps its chapters)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
