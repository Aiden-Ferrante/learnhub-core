"use client"

/** The Library (docs/ui-spec.md §3): the Today panel on top, then the course grid with its
 *  group sidebar. Admin entry points (Upload, Process) sit in the header, quietly. */

import { useMemo, useState } from "react"
import Link from "next/link"
import { GraduationCap, Plus, Zap } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Input } from "@/kit/ui/input"
import { EmptyState } from "@/kit/patterns/empty-state"
import { PageHeader } from "@/kit/patterns/page-header"
import { Sheet } from "@/kit/study"
import { CourseCard } from "@/surfaces/library/course-card"
import { addGroup, coursesInGroup, renameGroup, toggleMembership } from "@/surfaces/library/course-groups"
import { courseFromDocument, type Course } from "@/surfaces/library/courses"
import { DeleteCourseDialog } from "@/surfaces/library/delete-course-dialog"
import { GroupDialog, type GroupDialogState } from "@/surfaces/library/group-dialog"
import { GroupPanel } from "@/surfaces/library/group-panel"
import { TodayPanel } from "@/surfaces/library/today-panel"
import { UnlistedBooks } from "@/surfaces/library/unlisted-books"
import { useCourseGroups } from "@/surfaces/library/use-course-groups"
import { useReadingPositions, useStudyDebt } from "@/surfaces/library/use-library-queries"
import { useDocuments } from "@/surfaces/processing"

function FirstCourse() {
  return (
    <EmptyState
      icon={<GraduationCap />}
      title="Start your first course"
      description="Drop in a PDF and Learn Hub turns it into concepts you can study: read it, recall it, and track what you've mastered. Upload → Process → Study."
      action={
        <Button asChild>
          <Link href="/upload">
            <Plus />
            Upload a document
          </Link>
        </Button>
      }
      className="min-h-[420px]"
    />
  )
}

export function CourseShelf() {
  const { documents } = useDocuments()
  const courses = useMemo(() => documents.map(courseFromDocument), [documents])

  // Per-course due counts and saved reading positions: one cached read each, shared by
  // every card (and by the Today panel and the course home).
  const debt = useStudyDebt()
  const positions = useReadingPositions()
  const dueByDoc = useMemo(
    () => new Map((debt.data?.courses ?? []).map((c) => [c.doc, c.dueNow])),
    [debt.data],
  )

  const groups = useCourseGroups()
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<GroupDialogState>(null)
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null)

  const [query, setQuery] = useState("")
  const visibleCourses = useMemo(() => {
    let list = courses
    if (selectedGroupId) {
      const ids = coursesInGroup(selectedGroupId, groups.state.membership, groups.state.groups)
      list = list.filter((c) => ids.has(c.id))
    }
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((c) => c.title.toLowerCase().includes(q))
    return list
  }, [courses, selectedGroupId, groups.state, query])

  const submitDialog = (name: string, parentId: string | null) => {
    if (dialog?.mode === "rename") {
      groups.update((s) => renameGroup(s, dialog.groupId, name))
    } else if (dialog?.mode === "new") {
      const { tagCourseId } = dialog
      let createdId: string | null = null
      groups.update((s) => {
        const { state, id } = addGroup(s, name, parentId)
        createdId = id
        return tagCourseId ? toggleMembership(state, tagCourseId, id) : state
      })
      // Reveal the freshly created group.
      if (createdId) setSelectedGroupId(createdId)
    }
    setDialog(null)
  }
  const newGroup = (tagCourseId: string | null) => setDialog({ mode: "new", parentId: selectedGroupId, tagCourseId })

  return (
    <>
      <PageHeader
        title="Library"
        description="Your courses, each one built from a document you processed."
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/upload">
                <Plus />
                Upload
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/process">
                <Zap />
                Process
              </Link>
            </Button>
          </>
        }
      />

      <TodayPanel courses={courses} />

      {courses.length === 0 ? (
        <FirstCourse />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <GroupPanel
            groups={groups}
            totalCount={courses.length}
            selectedGroupId={selectedGroupId}
            onSelect={setSelectedGroupId}
            onNewGroup={() => newGroup(null)}
            onRenameGroup={(groupId, name) => setDialog({ mode: "rename", groupId, name })}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {courses.length > 4 && (
              <Input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search courses…"
                aria-label="Search courses"
              />
            )}
            {visibleCourses.length === 0 && query.trim() && (
              <p className="text-body text-muted-foreground">No courses match “{query}”.</p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  dueNow={course.learnDocId ? (dueByDoc.get(course.learnDocId) ?? 0) : 0}
                  continueKey={positions.data?.[course.id] ?? null}
                  groups={groups.state.groups}
                  courseGroupIds={groups.state.membership[course.id] ?? []}
                  groupsReady={groups.ready}
                  onDelete={setDeleteTarget}
                  onToggleMembership={(courseId, groupId) =>
                    groups.update((s) => toggleMembership(s, courseId, groupId))
                  }
                  onNewGroupForCourse={newGroup}
                />
              ))}
              {!selectedGroupId && (
                <Link href="/upload" className="group block rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Sheet as="div" className="h-full min-h-[140px] items-center justify-center border-dashed text-muted-foreground transition-colors group-hover:border-brand/50 group-hover:text-foreground">
                    <Plus className="h-6 w-6" />
                    <span className="text-body font-medium">New course</span>
                    <span className="text-meta">Upload &amp; process a document</span>
                  </Sheet>
                </Link>
              )}
            </div>
            {selectedGroupId && visibleCourses.length === 0 && !query.trim() && (
              <EmptyState
                title="No courses in this group yet"
                description="Use the menu on a course card to move one here."
              />
            )}
          </div>
        </div>
      )}

      {!selectedGroupId && <UnlistedBooks courses={courses} onDelete={setDeleteTarget} />}

      <GroupDialog state={dialog} groups={groups.state.groups} onClose={() => setDialog(null)} onSubmit={submitDialog} />
      <DeleteCourseDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </>
  )
}
