"use client"

import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/kit/ui/dialog"
import { Input } from "@/kit/ui/input"
import { Label } from "@/kit/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/kit/ui/select"
import type { CourseGroup } from "@/surfaces/library/course-groups"

const ROOT_PARENT = "__root__"

/** What the group dialog is doing: creating a group (optionally tagging a course into it)
 *  or renaming one. null = closed. */
export type GroupDialogState =
  | { mode: "new"; parentId: string | null; tagCourseId: string | null }
  | { mode: "rename"; groupId: string; name: string }
  | null

function GroupForm({
  state,
  groups,
  onCancel,
  onSubmit,
}: {
  state: Exclude<GroupDialogState, null>
  groups: CourseGroup[]
  onCancel: () => void
  onSubmit: (name: string, parentId: string | null) => void
}) {
  const [name, setName] = useState(state.mode === "rename" ? state.name : "")
  const [parent, setParent] = useState(state.mode === "new" ? (state.parentId ?? ROOT_PARENT) : ROOT_PARENT)
  const submit = () => {
    const trimmed = name.trim()
    if (trimmed) onSubmit(trimmed, parent === ROOT_PARENT ? null : parent)
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{state.mode === "rename" ? "Rename group" : "New group"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mathematics"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
            }}
          />
        </div>
        {state.mode === "new" && (
          <div className="space-y-1.5">
            <Label>Parent group</Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_PARENT}>Top level</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!name.trim()}>
          {state.mode === "rename" ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </>
  )
}

export function GroupDialog({
  state,
  groups,
  onClose,
  onSubmit,
}: {
  state: GroupDialogState
  groups: CourseGroup[]
  onClose: () => void
  onSubmit: (name: string, parentId: string | null) => void
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {state && <GroupForm state={state} groups={groups} onCancel={onClose} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  )
}
