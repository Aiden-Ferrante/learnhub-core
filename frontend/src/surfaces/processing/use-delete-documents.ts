"use client"

/** Deleting books from the documents table: the BOOK first (impact read, then the
 *  delete with its token), then the card — never the other way round, and never the
 *  card alone. A card left behind is the honest outcome for a delete that failed: it is
 *  the thing you point at to try again.
 *
 *  A card whose document is already gone still prunes: the backend answers 200 with
 *  `alreadyGone` rather than 404 (v0.17.0), so an orphan card is deletable. */

import { deleteLearnDocument, fetchLearnDeletion } from "@/gateways/api/pipeline"
import { ApiError, toApiError } from "@/gateways/api/http"
import { roots, useApiMutation } from "@/kit/data"
import { toast } from "@/kit/hooks/use-toast"
import { useDocuments, type Document } from "@/surfaces/processing/document-context"

export type DeleteOutcome = { deleted: string[]; failed: string[]; lastError: ApiError | null }

/** Everything a removed book took with it: its content, reviews, packs and counts. */
const DELETE_INVALIDATES = [
  roots.learnDocuments,
  roots.studyDebt,
  roots.reviewQueue,
  roots.reviewCalendar,
  roots.mastery,
  roots.courseStatus,
  roots.deletion,
  roots.packs,
  roots.jobs,
]

async function deleteBooks(ids: string[], documents: Document[]): Promise<DeleteOutcome> {
  const deleted: string[] = []
  const failed: string[] = []
  let lastError: ApiError | null = null
  for (const id of ids) {
    const learnDocId = documents.find((d) => d.id === id)?.learnDocId
    if (!learnDocId) {
      deleted.push(id) // never reached the backend at all
      continue
    }
    try {
      // Read the impact, then delete with its token: the backend refuses otherwise.
      const impact = await fetchLearnDeletion(learnDocId)
      if (!impact.token) throw new ApiError(0, "The server issued no deletion token")
      await deleteLearnDocument(learnDocId, impact.token)
      deleted.push(id)
    } catch (err) {
      // Not swallowed: the card stays, stays selected, and the reason is shown.
      failed.push(id)
      lastError = toApiError(err)
    }
  }
  return { deleted, failed, lastError }
}

export function useDeleteDocuments(onDone: (outcome: DeleteOutcome) => void) {
  const { documents, deleteDocuments } = useDocuments()
  return useApiMutation((ids: string[]) => deleteBooks(ids, documents), {
    invalidates: DELETE_INVALIDATES,
    onSuccess: (outcome) => {
      // Only the ones that actually went.
      if (outcome.deleted.length > 0) deleteDocuments(outcome.deleted)
      if (outcome.failed.length === 0) {
        toast({
          title: outcome.deleted.length === 1 ? "Document deleted" : "Documents deleted",
          description: `Deleted ${outcome.deleted.length} document${outcome.deleted.length === 1 ? "" : "s"}.`,
          duration: 3000,
        })
      } else {
        toast({
          title: "Delete failed",
          variant: "destructive",
          description:
            outcome.deleted.length > 0
              ? `Deleted ${outcome.deleted.length}, but ${outcome.failed.length} could not be removed and are still selected.`
              : `Could not delete ${outcome.failed.length} document(s). Nothing was removed.`,
          duration: 6000,
        })
      }
      onDone(outcome)
    },
  })
}
