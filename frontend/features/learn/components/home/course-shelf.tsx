"use client"

import { useEffect, useMemo, useState } from "react"
import { BookOpen, GraduationCap, Loader2, MoreVertical, Plus, Trash2, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GroupSidebar } from "@/features/learn/components/home/group-sidebar"
import { TodayStrip } from "@/features/learn/components/home/today-strip"
import {
  countSections,
  deleteLearnDocument,
  type LearnTreeNode,
  type MasteryResponse,
} from "@/features/learn/api"
import {
  addGroup,
  buildGroupTree,
  coursesInGroup,
  deleteGroup,
  EMPTY_GROUPS_STATE,
  fetchGroupsState,
  persistGroupsState,
  renameGroup,
  takeLegacyGroupsState,
  toggleMembership,
  type CourseGroup,
  type GroupsState,
} from "@/features/learn/lib/course-groups"
import { courseFromDocument, type Course, type CourseStatus } from "@/features/learn/lib/courses"
import { useDocuments } from "@/features/documents/document-context"

type CourseShelfProps = {
  liveTree: LearnTreeNode[]
  liveMastery: MasteryResponse | null
  liveLoading: boolean
  /** The course `liveTree`/`liveMastery` actually describe — only that card shows live stats,
   *  so other cards don't display this one's numbers as their own. */
  liveCourseId?: string | null
  onSelect: (course: Course) => void
  onNewCourse?: () => void
  /** Open the processing dashboard (extraction/TOC) — material management lives here now. */
  onProcess?: () => void
}

const STATUS_BADGE: Record<CourseStatus, { label: string; variant: "secondary" | "outline" }> = {
  ready: { label: "Ready", variant: "secondary" },
  processing: { label: "Processing", variant: "outline" },
  empty: { label: "Not processed", variant: "outline" },
}

const ROOT_PARENT = "__root__"

/** Small conic-gradient mastery ring, matching CourseHome. */
function MiniRing({ pct }: { pct: number }) {
  return (
    <div
      className="relative h-12 w-12 shrink-0 rounded-full"
      style={{
        background: `conic-gradient(hsl(var(--brand)) ${pct * 3.6}deg, hsl(var(--muted)) 0deg)`,
      }}
    >
      <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-card">
        <span className="text-xs font-semibold tabular-nums">{pct}%</span>
      </div>
    </div>
  )
}

function CourseCard({
  course,
  sections,
  overallPct,
  loading,
  groups,
  courseGroupIds,
  onSelect,
  onToggleMembership,
  onNewGroupForCourse,
  onDelete,
}: {
  course: Course
  sections: number | null
  overallPct: number | null
  loading: boolean
  groups: CourseGroup[]
  courseGroupIds: string[]
  onSelect: (course: Course) => void
  onToggleMembership: (courseId: string, groupId: string) => void
  onNewGroupForCourse: (courseId: string) => void
  onDelete: (course: Course) => void
}) {
  const badge = STATUS_BADGE[course.status]
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-brand/50">
      {/* Move-to-group menu */}
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 backdrop-blur transition hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label="Move to group"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Move to group</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {groups.length === 0 ? (
              <DropdownMenuItem disabled>No groups yet</DropdownMenuItem>
            ) : (
              groups.map((g) => (
                <DropdownMenuCheckboxItem
                  key={g.id}
                  checked={courseGroupIds.includes(g.id)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => onToggleMembership(course.id, g.id)}
                >
                  {g.name}
                </DropdownMenuCheckboxItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onNewGroupForCourse(course.id)}>
              <Plus className="h-4 w-4" />
              New group…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(course)}
            >
              <Trash2 className="h-4 w-4" />
              Delete course…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={() => onSelect(course)}
        className="flex flex-1 flex-col text-left"
      >
        {/* Cover strip — neutral surface; green is reserved for progress + focus. */}
        <div className="flex h-20 items-center justify-center border-b bg-muted/20">
          <BookOpen className="h-7 w-7 text-muted-foreground/60" />
        </div>

        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-start justify-between gap-2 pr-6">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{course.title}</h3>
            {course.format && (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {course.format}
              </span>
            )}
          </div>
          <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">{course.description}</p>

          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={badge.variant} className="text-[10px]">
                {badge.label}
              </Badge>
              {sections != null &&
                (loading ? (
                  <Skeleton className="h-3.5 w-16" />
                ) : (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {sections} sections
                  </span>
                ))}
            </div>
            {overallPct != null && !loading && <MiniRing pct={overallPct} />}
          </div>
        </div>
      </button>
    </div>
  )
}

export function CourseShelf({
  liveTree,
  liveMastery,
  liveLoading,
  liveCourseId,
  onSelect,
  onNewCourse,
  onProcess,
}: CourseShelfProps) {
  const liveSections = useMemo(() => countSections(liveTree), [liveTree])

  const { documents, deleteDocuments } = useDocuments()
  const courses = useMemo(() => documents.map(courseFromDocument), [documents])

  // Delete flow: cascade the learn-service content (sections, concepts, reviews, artifacts)
  // and then drop the course from the client's document list — no more DB surgery to remove
  // a duplicate or broken ingest.
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      if (deleteTarget.learnDocId) {
        const res = await deleteLearnDocument(deleteTarget.learnDocId)
        if (res.error) throw new Error(res.error)
      }
      deleteDocuments([deleteTarget.id])
      setDeleteTarget(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleteBusy(false)
    }
  }

  const [groupsState, setGroupsState] = useState<GroupsState>(EMPTY_GROUPS_STATE)
  const [groupsHydrated, setGroupsHydrated] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchGroupsState().then((server) => {
      if (cancelled) return
      const state = server ?? takeLegacyGroupsState()
      if (state) setGroupsState(state)
      setGroupsHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist only after hydration so the initial empty state can't clobber saved groups.
  useEffect(() => {
    if (!groupsHydrated) return
    persistGroupsState(groupsState)
  }, [groupsState, groupsHydrated])

  const groupTree = useMemo(() => buildGroupTree(groupsState.groups), [groupsState.groups])

  // groupId → count of courses tagged into it (including descendants).
  const courseCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const g of groupsState.groups) {
      counts[g.id] = coursesInGroup(g.id, groupsState.membership, groupsState.groups).size
    }
    return counts
  }, [groupsState])

  const [query, setQuery] = useState("")
  const visibleCourses = useMemo(() => {
    let list = courses
    if (selectedGroupId) {
      const ids = coursesInGroup(selectedGroupId, groupsState.membership, groupsState.groups)
      list = list.filter((c) => ids.has(c.id))
    }
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((c) => c.title.toLowerCase().includes(q))
    return list
  }, [courses, selectedGroupId, groupsState, query])

  // Dialog state: creating a new group or renaming an existing one.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<"new" | "rename">("new")
  const [nameInput, setNameInput] = useState("")
  const [parentInput, setParentInput] = useState<string>(ROOT_PARENT)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [tagCourseId, setTagCourseId] = useState<string | null>(null)

  const openNewGroupDialog = (courseId: string | null) => {
    setDialogMode("new")
    setNameInput("")
    setParentInput(selectedGroupId ?? ROOT_PARENT)
    setEditingGroupId(null)
    setTagCourseId(courseId)
    setDialogOpen(true)
  }

  const openRenameDialog = (groupId: string, currentName: string) => {
    setDialogMode("rename")
    setNameInput(currentName)
    setEditingGroupId(groupId)
    setTagCourseId(null)
    setDialogOpen(true)
  }

  const handleToggleMembership = (courseId: string, groupId: string) => {
    setGroupsState((prev) => toggleMembership(prev, courseId, groupId))
  }

  const handleDeleteGroup = (groupId: string) => {
    setGroupsState((prev) => deleteGroup(prev, groupId))
    setSelectedGroupId((prev) => (prev === groupId ? null : prev))
  }

  const submitDialog = () => {
    const name = nameInput.trim()
    if (!name) return
    if (dialogMode === "rename" && editingGroupId) {
      setGroupsState((prev) => renameGroup(prev, editingGroupId, name))
    } else {
      const parentId = parentInput === ROOT_PARENT ? null : parentInput
      setGroupsState((prev) => {
        const { state, id } = addGroup(prev, name, parentId)
        const next = tagCourseId ? toggleMembership(state, tagCourseId, id) : state
        // Reveal the freshly created group.
        setSelectedGroupId(id)
        return next
      })
    }
    setDialogOpen(false)
  }

  // For the parent <Select>, exclude the group being renamed and its descendants
  // (a group cannot be nested under itself). Only relevant in "new" mode here.
  const parentOptions = useMemo<CourseGroup[]>(() => {
    if (dialogMode === "rename") return []
    return groupsState.groups
  }, [dialogMode, groupsState.groups])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/15">
          <GraduationCap className="h-4 w-4 text-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">Learn</h2>
          <p className="text-sm text-muted-foreground">
            Your courses — each one built from a document you processed.
          </p>
        </div>
        {/* Material management moved off the top tabs — it lives with the shelf now. */}
        <div className="flex items-center gap-1.5">
          {onNewCourse && (
            <button
              type="button"
              onClick={onNewCourse}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Upload
            </button>
          )}
          {onProcess && (
            <button
              type="button"
              onClick={onProcess}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
            >
              <Zap className="h-3.5 w-3.5" />
              Process
            </button>
          )}
        </div>
      </div>

      <TodayStrip />

      {courses.length === 0 ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 ring-1 ring-brand/25">
            <GraduationCap className="h-7 w-7 text-brand" />
          </div>
          <h3 className="text-xl font-semibold">Start your first course</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Drop in a PDF and Learn Hub turns it into concepts you can study —
            read it, get quizzed, and track what you&rsquo;ve mastered.
          </p>
          <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted/60 px-2.5 py-1">1 · Upload</span>
            <span aria-hidden>→</span>
            <span className="rounded-full bg-muted/60 px-2.5 py-1">2 · Process</span>
            <span aria-hidden>→</span>
            <span className="rounded-full bg-brand/15 px-2.5 py-1 text-brand">3 · Study</span>
          </div>
          {onNewCourse && (
            <button
              type="button"
              onClick={onNewCourse}
              className="mt-7 inline-flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2.5 text-sm font-medium text-brand transition-colors hover:bg-brand/20 focus:outline-none focus:ring-2 focus:ring-brand/50"
            >
              <Plus className="h-4 w-4" />
              Upload a document
            </button>
          )}
        </div>
      ) : (
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="lg:w-56 lg:shrink-0">
          <div className="lg:sticky lg:top-4 lg:h-[520px]">
            <GroupSidebar
              tree={groupTree}
              selectedGroupId={selectedGroupId}
              totalCount={courses.length}
              courseCounts={courseCounts}
              onSelect={setSelectedGroupId}
              onNewGroup={() => openNewGroupDialog(null)}
              onRenameGroup={openRenameDialog}
              onDeleteGroup={handleDeleteGroup}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {courses.length > 4 && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search courses…"
              aria-label="Search courses"
              className="mb-4 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-brand/50"
            />
          )}
          {visibleCourses.length === 0 && query.trim() && (
            <p className="mb-4 text-sm text-muted-foreground">No courses match “{query}”.</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleCourses.map((course) => {
              const ready = course.status === "ready"
              return (
                <CourseCard
                  key={course.id}
                  course={course}
                  sections={ready && course.id === liveCourseId ? liveSections : null}
                  overallPct={
                    ready && course.id === liveCourseId && liveMastery
                      ? Math.round(liveMastery.overall * 100)
                      : null
                  }
                  loading={ready && course.id === liveCourseId ? liveLoading : false}
                  groups={groupsState.groups}
                  courseGroupIds={groupsState.membership[course.id] ?? []}
                  onDelete={setDeleteTarget}
                  onSelect={onSelect}
                  onToggleMembership={handleToggleMembership}
                  onNewGroupForCourse={openNewGroupDialog}
                />
              )
            })}

            {!selectedGroupId && onNewCourse && (
              <button
                type="button"
                onClick={onNewCourse}
                className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
              >
                <Plus className="h-6 w-6" />
                <span className="text-sm font-medium">New course</span>
                <span className="text-xs">Upload &amp; process a document</span>
              </button>
            )}
          </div>

          {selectedGroupId && visibleCourses.length === 0 && (
            <div className="rounded-lg border border-dashed bg-card p-8 text-center">
              <p className="text-sm font-medium">No courses in this group yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the &ldquo;Move to group&rdquo; menu on a course card to add one here.
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialogMode === "rename" ? "Rename group" : "New group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Mathematics"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitDialog()
                }}
              />
            </div>
            {dialogMode === "new" && (
              <div className="space-y-1.5">
                <Label>Parent group</Label>
                <Select value={parentInput} onValueChange={setParentInput}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOT_PARENT}>Top level</SelectItem>
                    {parentOptions.map((g) => (
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
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitDialog} disabled={!nameInput.trim()}>
              {dialogMode === "rename" ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-course confirmation */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.title}”?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              This permanently removes the course and everything built from it: the converted
              book, sections, figures, extracted concepts, quiz questions, and your review
              history for it.
            </p>
            <p>The original PDF on your computer is not touched.</p>
            {deleteError && <p className="text-destructive">{deleteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteBusy} onClick={confirmDelete}>
              {deleteBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Delete course
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
