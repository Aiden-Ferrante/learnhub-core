"use client"

import { Loader2, Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/kit/ui/dialog"
import { ApiError } from "@/gateways/api/http"
import { deleteLearnDocument, fetchLearnDeletion } from "@/gateways/api/pipeline"
import { fetchVersions } from "@/gateways/api/versions"
import { ErrorNotice, qk, roots, useApi, useApiMutation, orThrow } from "@/kit/data"
import type { Course } from "@/surfaces/library/courses"
import { useDocuments } from "@/surfaces/processing"

/** Delete one course: cascade the learn-service content (sections, concepts, reviews,
 *  artifacts) through the impact read's token, then drop the card from the document list. */
export function DeleteCourseDialog({ target, onClose }: { target: Course | null; onClose: () => void }) {
  const { deleteDocuments } = useDocuments()
  const doc = target?.learnDocId

  // The book's OTHER courses, so the dialog can name everything it destroys. A failed read
  // says so but does not block the delete: an unknown list is a reason to say less, not a
  // reason to stop someone removing a book.
  const versions = useApi(qk.versions(doc ?? ""), (signal) => fetchVersions(doc as string, signal).then(orThrow), {
    enabled: !!doc,
  })
  const siblings = (versions.data?.versions ?? []).filter((v) => v.docId !== doc).map((v) => v.name)

  const remove = useApiMutation(
    async (course: Course) => {
      if (course.learnDocId) {
        // No impact read, no token, no delete.
        const impact = await fetchLearnDeletion(course.learnDocId)
        if (impact.error || !impact.token) throw new ApiError(500, impact.error || "No deletion token")
        orThrow(await deleteLearnDocument(course.learnDocId, impact.token))
      }
      return course
    },
    {
      invalidates: [roots.studyDebt, roots.versions, roots.packs, roots.mastery],
      onSuccess: (course) => {
        deleteDocuments([course.id])
        onClose()
      },
    },
  )

  const close = () => {
    if (remove.pending) return
    remove.reset()
    onClose()
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{target?.title}”?</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-body text-muted-foreground">
          <p>
            This permanently removes the course and everything built from it: the converted book,
            sections, figures, extracted concepts, and your review history for it.
          </p>
          {/* Deleting a book takes EVERY course cut from it, not just the one on the card. */}
          {siblings.length > 0 && (
            <p className="text-ink-danger">
              This book carries {siblings.length + 1} courses and all of them go:{" "}
              <strong>{siblings.join(", ")}</strong>, each with its own outline and its own progress.
            </p>
          )}
          {versions.error && (
            <ErrorNotice compact title="Couldn't list this book's other courses" error={versions.error} onRetry={versions.retry} />
          )}
          <p>The original PDF on your computer is not touched.</p>
          {remove.error && <ErrorNotice compact title="Not deleted" error={remove.error} />}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={remove.pending} onClick={close}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={remove.pending || !target} onClick={() => target && remove.fire(target)}>
            {remove.pending ? (
              <>
                <Loader2 className="animate-spin" /> Deleting…
              </>
            ) : (
              <>
                <Trash2 /> Delete course
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
