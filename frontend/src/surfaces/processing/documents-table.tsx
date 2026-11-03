"use client"

/** The documents table on /upload: every card in the library with select (shift-click
 *  ranges), rename, download and delete. The list comes from the DocumentProvider, so it
 *  renders through AsyncView with the provider's load state: loading, "Couldn't load your
 *  library · Retry", empty, or the rows. */

import { useMemo, useState } from "react"
import { FileText, Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { EmptyState } from "@/kit/patterns/empty-state"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/kit/ui/alert-dialog"
import { AsyncView, ErrorNotice, type ApiQuery } from "@/kit/data"
import { useDocuments, type Document } from "@/surfaces/processing/document-context"
import { DocumentRow } from "@/surfaces/processing/document-row"
import { useDeleteDocuments } from "@/surfaces/processing/use-delete-documents"
import { useShiftSelect } from "@/surfaces/processing/use-shift-select"

type DeleteTarget = { type: "single"; docId: string; docName: string } | { type: "multiple" }

/** The provider's load state in the shape AsyncView reads. */
function useDocumentsQuery(): ApiQuery<Document[]> {
  const { documents, isInitialized, error, retry } = useDocuments()
  return useMemo(
    () => ({
      data: isInitialized && !error ? documents : undefined,
      status: error ? "error" : isInitialized ? "success" : "loading",
      refreshing: false,
      error,
      retry,
    }),
    [documents, isInitialized, error, retry],
  )
}

export function DocumentsTable() {
  const q = useDocumentsQuery()
  // Loading, error and empty sit padded inside the card; the table runs edge to edge.
  return (
    <div className={q.data?.length ? undefined : "p-4"}>
      <AsyncView
        q={q}
        errorTitle="Couldn't load your library"
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={<FileText />}
            title="No documents uploaded yet"
            description="Upload a PDF or Markdown file (.pdf converts automatically, .md imports as is). Learn Hub builds a course from it."
          />
        }
      >
        {(documents) => <Table documents={documents} />}
      </AsyncView>
    </div>
  )
}

function Table({ documents }: { documents: Document[] }) {
  const { renameDocument } = useDocuments()
  const [target, setTarget] = useState<DeleteTarget | null>(null)
  const { selectedItems, setSelectedItems, handleItemClick, handleSelectAll, isSelected } = useShiftSelect({
    items: documents,
    getItemId: (doc) => doc.id,
  })
  const remove = useDeleteDocuments((outcome) => {
    // Deleted cards leave the selection; failed ones stay selected, ready to try again.
    setSelectedItems(selectedItems.filter((id) => !outcome.deleted.includes(id)))
    setTarget(null)
  })

  const idsFor = (t: DeleteTarget) => (t.type === "multiple" ? selectedItems : [t.docId])
  const confirm = () => {
    if (!target || remove.pending) return
    const ids = idsFor(target)
    if (ids.length > 0) remove.fire(ids)
  }
  const lastFailure = remove.error ?? remove.data?.lastError ?? null

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <label className="flex items-center gap-4">
          <input
            type="checkbox"
            className="selection-accent h-4 w-4 rounded border-border"
            checked={selectedItems.length === documents.length}
            onChange={handleSelectAll}
          />
          <span className="flex flex-col">
            <span className="text-meta font-medium">
              {selectedItems.length > 0 ? (
                <span className="text-ink-accent">{selectedItems.length} selected</span>
              ) : (
                "Select all documents"
              )}
            </span>
            <span className="text-micro text-muted-foreground">
              {documents.length} total document{documents.length !== 1 ? "s" : ""}
            </span>
          </span>
        </label>
        {selectedItems.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 text-ink-danger"
            onClick={() => setTarget({ type: "multiple" })}
          >
            <Trash2 className="h-4 w-4" />
            Delete selected ({selectedItems.length})
          </Button>
        )}
      </div>
      {lastFailure && (
        <ErrorNotice
          compact
          className="border-b px-4 py-2"
          title="Not deleted"
          error={lastFailure}
          onRetry={() => remove.data?.failed.length && remove.fire(remove.data.failed)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="w-12 py-3 pl-4" />
              <th className="py-3 text-left text-micro font-semibold uppercase tracking-th text-muted-foreground">Name</th>
              <th className="py-3 text-left text-micro font-semibold uppercase tracking-th text-muted-foreground">Status</th>
              <th className="py-3 pr-4 text-right text-micro font-semibold uppercase tracking-th text-muted-foreground">
                Size (KB)
              </th>
              <th className="py-3 pr-4 text-center text-micro font-semibold uppercase tracking-th text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                selected={isSelected(doc.id)}
                onSelect={(e) => handleItemClick(doc, e)}
                onRename={(name) => renameDocument(doc.id, name)}
                onDelete={() => setTarget({ type: "single", docId: doc.id, docName: doc.name })}
              />
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && !remove.pending && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-ink-danger" />
              Delete {target?.type === "multiple" ? "documents" : "document"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target?.type === "multiple" ? (
                <>
                  Are you sure you want to delete <strong>{selectedItems.length}</strong> selected document
                  {selectedItems.length !== 1 ? "s" : ""}? This action cannot be undone.
                </>
              ) : (
                <>
                  Are you sure you want to delete <strong>&ldquo;{target?.docName}&rdquo;</strong>? This action cannot
                  be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.pending}
              onClick={(e) => {
                // Keep the dialog open until the delete settles.
                e.preventDefault()
                confirm()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
