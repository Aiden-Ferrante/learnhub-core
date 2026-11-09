"use client"

/** The course-version picker: which cut of this book you are studying.
 *
 * A book can carry several courses over it. `Default` is the one built from the PDF's own
 * table of contents; the others are yours. They share the book's text and its extracted
 * concepts, and each keeps its own outline and its own progress — so switching is not a
 * filter, it is opening a different course.
 *
 * Picking a version makes it the book's *main* one, which is what the course card opens.
 * There is deliberately no separate "viewing but not main" state: one selection, one
 * meaning, and the page you are on becomes the page you come back to.
 */

import { useState } from "react"
import { Check, Layers, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice, roots, useApiMutation } from "@/kit/data"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/kit/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/kit/ui/dialog"
import { Input } from "@/kit/ui/input"
import { Label } from "@/kit/ui/label"
import {
  createVersion,
  deleteVersion,
  setMainVersion,
  type CourseVersion,
} from "@/gateways/api/versions"
import { followMainVersion } from "@/gateways/api/user-settings"

type VersionMenuProps = {
  /** Any version id of the book — the API resolves it to the whole set. */
  bookKey: string
  /** The course card's id, whose "Continue" follows the main version. */
  courseId: string
  versions: CourseVersion[]
  activeVersion: CourseVersion | null
}

/** A version change re-reads the set; a changed main flips the course's docKey, and every
 *  course read keyed by it follows. */
const VERSION_INVALIDATES = [roots.versions, roots.readingProgress]

type VersionAction = { kind: "switch"; docId: string } | { kind: "delete"; docId: string }

export function VersionMenu({ bookKey, courseId, versions, activeVersion }: VersionMenuProps) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  // Which version's delete button is armed. Reset on close — an armed button that
  // survived the menu closing would fire on a click meant for something else.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const act = useApiMutation(
    async (a: VersionAction): Promise<unknown> => {
      if (a.kind !== "switch") return deleteVersion(a.docId)
      await setMainVersion(a.docId)
      await followMainVersion(courseId, a.docId)
    },
    { invalidates: VERSION_INVALIDATES },
  )
  const create = useApiMutation(
    async (name: string) => {
      const made = await createVersion(bookKey, name)
      // A new version is created not-main; opening it immediately is what the user meant
      // by making one, so switch as part of the same action.
      await setMainVersion(made.docId)
      await followMainVersion(courseId, made.docId)
    },
    {
      invalidates: VERSION_INVALIDATES,
      onSuccess: () => {
        setCreating(false)
        setNewName("")
      },
    },
  )
  const busy = act.pending || create.pending

  // A book that only has its Default has nothing to switch between — but the button still
  // shows, because creating the second one is the whole point of it being there.
  const label = activeVersion?.name ?? "Default"

  function submitNew() {
    const name = newName.trim()
    if (name) create.fire(name)
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Layers />}
            {label}
            {versions.length > 1 && <span className="tabular-nums text-muted-foreground">· {versions.length}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Courses from this book
          </DropdownMenuLabel>
          {versions.map((v) => (
            <DropdownMenuItem
              key={v.docId}
              className="gap-2"
              onSelect={(e) => {
                e.preventDefault()
                if (!v.isMain) act.fire({ kind: "switch", docId: v.docId })
              }}
            >
              <Check
                className={`h-3.5 w-3.5 shrink-0 ${v.isMain ? "opacity-100" : "opacity-0"}`}
              />
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              <span className="shrink-0 tabular-nums text-meta text-muted-foreground">
                {v.blockCount}
              </span>
              {v.origin === "custom" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={
                    pendingDelete === v.docId
                      ? `Confirm deleting ${v.name}`
                      : `Delete ${v.name}`
                  }
                  title={
                    pendingDelete === v.docId
                      ? "Click again to delete this course — its outline and its progress go with it"
                      : `Delete ${v.name}`
                  }
                  className={`h-6 w-6 shrink-0 ${
                    pendingDelete === v.docId
                      ? "bg-destructive/15 text-ink-danger"
                      : "text-muted-foreground hover:text-ink-danger"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Two clicks, not one. Deleting a version destroys that course's outline
                    // and everything you have studied against it, and it sat behind a single
                    // unguarded click in a dropdown — next to the row that merely SWITCHES
                    // course (finding F4). A dialog would be heavier than the surrounding
                    // menu; arming the button is enough to make it deliberate.
                    if (pendingDelete !== v.docId) {
                      setPendingDelete(v.docId)
                      return
                    }
                    setPendingDelete(null)
                    act.fire({ kind: "delete", docId: v.docId })
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            onSelect={(e) => {
              e.preventDefault()
              setNewName("")
              create.reset()
              setCreating(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New course from this book
          </DropdownMenuItem>
          {/* Switch/delete keep the menu open (onSelect preventDefault), so a failure has
              somewhere to be seen instead of vanishing silently. */}
          {act.error && (
            <ErrorNotice compact title="Not changed" error={act.error} className="px-2 pb-1 pt-0.5" />
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={(o) => !busy && setCreating(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New course from this book</DialogTitle>
            <DialogDescription>
              Starts as a full copy of the book — same chapters, same material — with its own
              progress. Concepts you have already learned keep their review schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="version-name">Name</Label>
            <Input
              id="version-name"
              value={newName}
              autoFocus
              placeholder="Core ideas"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew()
              }}
            />
            {create.error && <ErrorNotice compact title="Not created" error={create.error} />}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={submitNew} disabled={busy || !newName.trim()}>
              {create.pending && <Loader2 className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
