"use client"

import type React from "react"

import { createContext, useContext, useState, useEffect, useRef } from "react"
import type { PreparedIngestFile } from "@/features/documents/lib/convert-pdf"

export type DocumentAddInput = File | PreparedIngestFile

export type Document = {
  id: string
  name: string
  status: "New" | "Processing" | "Processed" | "Error"
  uploadStatus: "Uploading" | "Uploaded"
  size: string
  file: File
  content?: string
  error?: string
  extractedDate?: Date
  convertedFromPdf?: boolean
  originalPdfName?: string
  /** Learn-service document id (content namespace) — keys reader/markdown lookups. */
  learnDocId?: string
}

type DocumentContextType = {
  documents: Document[]
  addDocuments: (items: DocumentAddInput[]) => void
  deleteDocuments: (documentIds: string[]) => void
  clearDocuments: () => void
  renameDocument: (documentId: string, name: string) => void
}

const DocumentContext = createContext<DocumentContextType | undefined>(undefined)

// Utility function to generate UUID with fallback
const generateUUID = (): string => {
  // Check if crypto.randomUUID is available
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch (error) {
      console.warn('crypto.randomUUID failed, using fallback:', error);
    }
  }

  // Fallback UUID generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export function DocumentProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [isInitialized, setIsInitialized] = useState(false)
  // Only enable the destructive autosave once the initial load SUCCEEDS. If the
  // first GET fails (e.g. a transient 401/500), documents stays [] and an autosave
  // would otherwise PUT an empty list and wipe the durable server copy.
  const canPersistRef = useRef(false)

  // Reconstruct File objects from serialized documents (server or localStorage)
  const reviveDocuments = (parsed: any[]): Document[] =>
    parsed.map((doc: any) => {
      let file: File
      if (doc.content) {
        const blob = new Blob([doc.content], { type: 'text/plain' })
        file = new File([blob], doc.name, { type: 'text/plain' })
      } else {
        file = new File([], doc.name, { type: 'text/plain' })
      }
      // Processing state lives in the tab that ran it; a persisted "Processing"
      // status means the run was interrupted (reload/crash) and would otherwise
      // spin forever and block re-processing.
      if (doc.status === 'Processing') {
        return {
          ...doc,
          file,
          status: 'Error',
          error: 'Processing was interrupted — run Process again.',
        }
      }
      return { ...doc, file }
    })

  // Serialize for server storage. Keep records SMALL and safe:
  //  - File isn't serializable -> store just its metadata (guard a missing file).
  //  - very large content (a converted book's markdown) is dropped; the durable
  //    copy lives server-side under learnDocId and is fetched on demand.
  const serializeDocuments = (docs: Document[]) =>
    docs.map((doc) => {
      const shouldSaveContent = !doc.content || doc.content.length < 100000
      return {
        ...doc,
        file: doc.file
          ? { name: doc.file.name, size: doc.file.size, type: doc.file.type }
          : { name: doc.name, size: 0, type: "text/plain" },
        content: shouldSaveContent ? doc.content : undefined,
      }
    })

  // Load documents from the server; one-time import from the legacy
  // localStorage store when the server list is still empty.
  useEffect(() => {
    if (isInitialized) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch('/api/documents')
        if (!res.ok) throw new Error(`GET /api/documents -> ${res.status}`)
        const data = await res.json()
        const serverDocs = Array.isArray(data.documents) ? data.documents : []
        // Load succeeded — safe to let the autosave persist from here on.
        canPersistRef.current = true

        if (serverDocs.length > 0) {
          if (!cancelled) setDocuments(reviveDocuments(serverDocs))
        } else {
          const saved = localStorage.getItem('learnhub_documents')
          if (saved) {
            const parsed = JSON.parse(saved)
            if (Array.isArray(parsed) && parsed.length > 0 && !cancelled) {
              console.log(`Importing ${parsed.length} documents from localStorage`)
              setDocuments(reviveDocuments(parsed))
            }
            // Remove so another account on this browser can't re-import them.
            localStorage.removeItem('learnhub_documents')
          }
        }
      } catch (error) {
        console.error('Error loading documents from server:', error)
      } finally {
        if (!cancelled) setIsInitialized(true)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [isInitialized])

  // Persist documents to the server (debounced), but only after a SUCCESSFUL
  // load — never autosave (and risk wiping) on top of a failed initial fetch.
  useEffect(() => {
    if (!isInitialized || !canPersistRef.current) return
    const timer = setTimeout(() => {
      fetch('/api/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: serializeDocuments(documents) }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`PUT /api/documents -> ${res.status}`)
        })
        .catch((error) => console.error('Error saving documents to server:', error))
    }, 800)
    return () => clearTimeout(timer)
  }, [documents, isInitialized])

  const addDocuments = (items: DocumentAddInput[]) => {
    const newDocuments = items.map((item) => {
      const prepared: PreparedIngestFile =
        item instanceof File ? { file: item } : item
      const { file, convertedFromPdf, originalPdfName, learnDocId } = prepared
      return {
        id: generateUUID(),
        name: file.name,
        status: "New" as const,
        uploadStatus: "Uploaded" as const,
        size: (file.size / 1024).toFixed(2),
        file,
        ...(convertedFromPdf ? { convertedFromPdf: true as const } : {}),
        ...(originalPdfName ? { originalPdfName } : {}),
        ...(learnDocId ? { learnDocId } : {}),
      }
    })

    setDocuments((prev) => [...prev, ...newDocuments])
  }

  const deleteDocuments = (documentIds: string[]) => {
    setDocuments((prev) => prev.filter((doc) => !documentIds.includes(doc.id)))
  }

  const clearDocuments = () => {
    setDocuments([])
    // Explicit clear — the route ignores empty PUTs by default (wipe guard), so
    // signal intent with ?clear=1.
    fetch('/api/documents?clear=1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: [] }),
    }).catch((error) => console.error('Error clearing documents:', error))
  }

  const renameDocument = (documentId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === documentId ? { ...doc, name: trimmed } : doc)),
    )
  }

  return (
    <DocumentContext.Provider
      value={{
        documents,
        addDocuments,
        deleteDocuments,
        clearDocuments,
        renameDocument,
      }}
    >
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocuments() {
  const context = useContext(DocumentContext)
  if (context === undefined) {
    throw new Error("useDocuments must be used within a DocumentProvider")
  }
  return context
}
