"use client"

import { useState } from "react"
import { CheckCircle, AlertCircle, Loader2, Trash2, FileText, Download, Info, Pencil } from "lucide-react"
import { useDocuments } from "@/features/documents/document-context"
import { useShiftSelect } from "@/features/documents/hooks/use-shift-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { downloadDocument } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"

export interface DocumentsTableProps {
  onTabChange?: (tab: string) => void;
}

export function DocumentsTable({ onTabChange }: DocumentsTableProps) {
  const { documents, deleteDocuments, renameDocument } = useDocuments()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")

  // Delete confirmation dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'single' | 'multiple', docId?: string, docName?: string } | null>(null)

  // Use shift-select hook for document selection
  const {
    selectedItems: selectedDocuments,
    setSelectedItems: setSelectedDocuments,
    handleItemClick,
    handleSelectAll,
    isSelected
  } = useShiftSelect({
    items: documents,
    getItemId: (doc) => doc.id,
    canSelect: () => true, // All documents can be selected in this table
    onSelectionChange: (selectedIds) => {
      // Optional: handle selection change if needed
    }
  })

  const handleDeleteSelected = () => {
    if (selectedDocuments.length === 0) return
    setDeleteTarget({ type: 'multiple' })
    setShowDeleteDialog(true)
  }
  
  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    
    if (deleteTarget.type === 'multiple') {
      deleteDocuments(selectedDocuments)
      setSelectedDocuments([])
      toast({
        title: "Documents Deleted",
        description: `Successfully deleted ${selectedDocuments.length} document(s).`,
        duration: 3000,
      })
    } else if (deleteTarget.type === 'single' && deleteTarget.docId) {
      deleteDocuments([deleteTarget.docId])
      toast({
        title: "Document Deleted",
        description: `"${deleteTarget.docName}" has been deleted.`,
        duration: 3000,
      })
    }
    
    setShowDeleteDialog(false)
    setDeleteTarget(null)
  }
  
  const startRename = (id: string, name: string) => {
    setEditingId(id)
    setEditingName(name)
  }

  const commitRename = () => {
    if (editingId) renameDocument(editingId, editingName)
    setEditingId(null)
    setEditingName("")
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditingName("")
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "New":
        return <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 mr-2"></span>
      case "Processing":
        return <Loader2 className="h-3.5 w-3.5 text-yellow-500 mr-2 animate-spin" />
      case "Processed":
        return <CheckCircle className="h-3.5 w-3.5 text-green-500 mr-2" />
      case "Error":
        return <AlertCircle className="h-3.5 w-3.5 text-destructive mr-2" />
      default:
        return <span className="h-1.5 w-1.5 rounded-full bg-gray-400 mr-2"></span>
    }
  }

  return (
    <div className="relative">
      <div className="flex justify-between items-center p-6 bg-muted/10 border-b border-border/20">
        <div className="flex items-center">
          <div className="relative flex items-center">
            <input
              type="checkbox"
              className="rounded border-border selection-accent mr-4 h-4 w-4"
              checked={selectedDocuments.length === documents.length && documents.length > 0}
              onChange={handleSelectAll}
              disabled={documents.length === 0}
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {selectedDocuments.length > 0 ? (
                  <span className="text-brand">{selectedDocuments.length} selected</span>
                ) : (
                  <span className="text-foreground">Select all documents</span>
                )}
              </span>
              {documents.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {documents.length} total document{documents.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {selectedDocuments.length > 0 && (
            <button 
              onClick={handleDeleteSelected} 
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-lg transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete Selected ({selectedDocuments.length})</span>
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/20 bg-muted/5">
              <th className="w-12 pl-6 py-3"></th>
              <th className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-left py-3">Name</th>
              <th className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-left py-3">Status</th>
              <th className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-left py-3">Upload Status</th>
              <th className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right py-3 pr-4">Size (KB)</th>
              <th className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center py-3 pr-6">Actions</th>
            </tr>
          </thead>
        <tbody>
          {documents.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-16">
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="w-24 h-24 rounded-2xl bg-brand/10 flex items-center justify-center mb-6 border-2 border-dashed border-brand/20">
                    <FileText className="h-12 w-12 text-brand" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground mb-3">No documents uploaded yet</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md leading-relaxed">
                    Get started by uploading a PDF (or markdown/text) — Learn Hub builds a course from it
                  </p>
                  <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-full border border-border/30">
                    <Info className="h-4 w-4" />
                    <span>Supported: .md, .csv, .txt, .json, .pdf (auto-convert)</span>
                  </div>
                </div>
              </td>
            </tr>
          ) : (
            documents.map((doc) => (
               <tr key={doc.id} className={`transition-all duration-200 hover:bg-brand/5 cursor-pointer group border-b border-border/10 last:border-b-0 ${isSelected(doc.id) ? 'bg-brand/8 border-l-4 border-l-brand' : 'hover:border-l-4 hover:border-l-brand/40'}`}
                   onClick={(e) => handleItemClick(doc, e)}>
                <td className="pl-6 py-4" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="rounded border-border selection-accent h-4 w-4"
                    checked={isSelected(doc.id)}
                    onChange={(e) => handleItemClick(doc, e)}
                  />
                </td>
                 <td className="py-4" onClick={editingId === doc.id ? (e) => e.stopPropagation() : undefined}>
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-brand flex-shrink-0" />
                    {editingId === doc.id ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingName}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            commitRename()
                          } else if (e.key === "Escape") {
                            e.preventDefault()
                            cancelRename()
                          }
                        }}
                        className="min-w-0 flex-1 max-w-[220px] rounded border border-input bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                      />
                    ) : (
                      <span className="text-sm font-medium text-foreground truncate max-w-[200px]" title={doc.name}>{doc.name}</span>
                    )}
                  </div>
                </td>
                <td className="py-4">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(doc.status)}
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      doc.status === 'Processed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                      doc.status === 'Processing' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                      doc.status === 'Error' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                      'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400'
                    }`}>{doc.status}</span>
                  </div>
                </td>
                <td className="py-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-brand" />
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">{doc.uploadStatus}</span>
                  </div>
                </td>
                <td className="py-4 text-right pr-4">
                  <span className="text-xs font-mono bg-muted/50 px-2 py-1 rounded">{doc.size}</span>
                </td>
                <td className="py-4 pr-6">
                  <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(doc.id, doc.name)
                      }}
                      className="p-2 text-muted-foreground hover:text-brand hover:bg-brand/10 rounded-lg transition-colors"
                      aria-label={`Rename ${doc.name}`}
                      title="Rename document"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        try {
                          downloadDocument(doc.file, doc.name)
                          toast({
                            title: "Download Started",
                            description: `"${doc.name}" is being downloaded.`,
                            duration: 3000,
                          })
                        } catch (error) {
                          console.error('Download failed:', error)
                          toast({
                            title: "Download Failed",
                            description: `Failed to download "${doc.name}". Please try again.`,
                            variant: "destructive",
                            duration: 5000,
                          })
                        }
                      }}
                      className="p-2 text-muted-foreground hover:text-brand hover:bg-brand/10 rounded-lg transition-colors"
                      aria-label={`Download ${doc.name}`}
                      title="Download document"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget({ type: 'single', docId: doc.id, docName: doc.name })
                        setShowDeleteDialog(true)
                      }}
                      className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                      aria-label={`Delete ${doc.name}`}
                      title="Delete document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
        </table>
      </div>
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete {deleteTarget?.type === 'multiple' ? 'Documents' : 'Document'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'multiple' ? (
                <>
                  Are you sure you want to delete <strong>{selectedDocuments.length}</strong> selected document{selectedDocuments.length !== 1 ? 's' : ''}? 
                  This action cannot be undone.
                </>
              ) : (
                <>
                  Are you sure you want to delete <strong>"{deleteTarget?.docName}"</strong>? 
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

