"use client"

import type React from "react"

import { createContext, useContext, useState, useEffect, useRef } from "react"
import {
  ConversionUnavailable,
  awaitPdfConversion,
  markdownToFile,
  type PreparedIngestFile,
} from "@/surfaces/processing/convert-pdf"
import { toast } from "@/kit/hooks/use-toast"
import { fetchAppDocuments, saveAppDocuments } from "@/gateways/api/documents"
import type { ApiError } from "@/gateways/api/http"
import { qk } from "@/kit/data/query-keys"
import { useApi } from "@/kit/data/use-api"

export type DocumentAddInput = File | PreparedIngestFile

export type Document = {
  id: string
  /** `Converting` = the book is being converted server-side; the card is a durable
   *  placeholder holding its learnDocId until the job reports done. */
  status: "New" | "Converting" | "Processed" | "Error"
  name: string
  uploadStatus: "Uploaded"
  size: string
  file: File
  content?: string
  error?: string
  convertedFromPdf?: boolean
  originalPdfName?: string
  /** Learn-service document id (content namespace) — keys reader/markdown lookups. */
  learnDocId?: string
}

type DocumentContextType = {
  documents: Document[]
  /** True once the initial server load has settled (loaded OR failed) — lets deep links
   *  distinguish "documents still loading" from "no such document". Check `error` too:
   *  a failed load is settled but is NOT "no such document". */
  isInitialized: boolean
  /** The initial load's failure, until a retry succeeds. null when loaded or loading. */
  error: ApiError | null
  /** Retry the initial load (the "Couldn't load your library · Retry" button). */
  retry: () => void
  /** Returns the cards it created, so a caller can settle one later by id. */
  addDocuments: (items: DocumentAddInput[]) => Document[]
  deleteDocuments: (documentIds: string[]) => void
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
  // Seeded once from the query below; from then on this local list is the truth and the
  // autosave writes it back. A later refetch must not clobber unsaved local edits, so the
  // query never goes stale on its own (staleMs Infinity) and only seeds once.
  const [seeded, setSeeded] = useState(false)
  const docsQuery = useApi(qk.documents(), (signal) => fetchAppDocuments(signal), { staleMs: Infinity })
  const isInitialized = seeded || (docsQuery.status === "error" && docsQuery.data === undefined)
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

  // Seed from the first successful server load; one-time import from the legacy
  // localStorage store when the server list is still empty.
  useEffect(() => {
    if (seeded || !docsQuery.data) return
    const serverDocs = docsQuery.data.documents
    // Load succeeded — safe to let the autosave persist from here on.
    canPersistRef.current = true
    if (serverDocs.length > 0) {
      setDocuments(reviveDocuments(serverDocs))
    } else {
      try {
        const saved = localStorage.getItem('learnhub_documents')
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setDocuments(reviveDocuments(parsed))
          }
          // Remove so another account on this browser can't re-import them.
          localStorage.removeItem('learnhub_documents')
        }
      } catch (error) {
        console.error('Ignoring an unreadable legacy localStorage document list:', error)
      }
    }
    setSeeded(true)
  }, [docsQuery.data, seeded])

  // Persist documents to the server (debounced), but only after a SUCCESSFUL
  // load — never autosave (and risk wiping) on top of a failed initial fetch.
  useEffect(() => {
    if (!isInitialized || !canPersistRef.current) return
    const timer = setTimeout(() => {
      saveAppDocuments(serializeDocuments(documents)).catch((error) => {
        // Not silent: the library would otherwise lose an edit with no sign of it.
        toast({
          title: "Library not saved",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        })
      })
    }, 800)
    return () => clearTimeout(timer)
  }, [documents, isInitialized])

  /** Patch one card in place — how a `Converting` placeholder becomes a finished book. */
  const updateDocument = (documentId: string, patch: Partial<Document>) => {
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === documentId ? { ...doc, ...patch } : doc)),
    )
  }

  // The ONE place a `Converting` card settles — whether an upload just started it or a
  // reload found one half-done. Conversion runs server-side and takes minutes, so the
  // card is written first and watched second: losing this tab only delays the flip, it
  // can never orphan a book that the learn service went on to finish.
  const settlingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!isInitialized) return
    for (const doc of documents) {
      if (doc.status !== "Converting" || !doc.learnDocId) continue
      if (settlingRef.current.has(doc.id)) continue
      settlingRef.current.add(doc.id)

      const cardId = doc.id
      const cardName = doc.name
      awaitPdfConversion(doc.learnDocId)
        .then((result) => {
          const converted = markdownToFile(result.markdown, result.outputFilename)
          updateDocument(cardId, {
            status: "New",
            file: converted,
            size: (converted.size / 1024).toFixed(2),
            convertedFromPdf: true,
          })
          toast({
            title: "PDF converted",
            description: `"${cardName}" is ready. Use Preview TOC before processing if you need section hierarchy.`,
          })
        })
        .catch((error) => {
          settlingRef.current.delete(cardId) // let a later visit pick it back up
          // We only stopped watching; the job outlives us. Leave the card Converting.
          if (error instanceof ConversionUnavailable) return
          const message = error instanceof Error ? error.message : String(error)
          updateDocument(cardId, { status: "Error", error: message })
          toast({
            title: "PDF conversion failed",
            description: message,
            variant: "destructive",
          })
        })
    }
  }, [documents, isInitialized])

  const addDocuments = (items: DocumentAddInput[]): Document[] => {
    const newDocuments = items.map((item) => {
      const prepared: PreparedIngestFile =
        item instanceof File ? { file: item } : item
      const { file, name, converting, convertedFromPdf, originalPdfName, learnDocId } = prepared
      return {
        id: generateUUID(),
        name: name ?? file.name,
        status: converting ? ("Converting" as const) : ("New" as const),
        uploadStatus: "Uploaded" as const,
        size: (file.size / 1024).toFixed(2),
        file,
        ...(convertedFromPdf ? { convertedFromPdf: true as const } : {}),
        ...(originalPdfName ? { originalPdfName } : {}),
        ...(learnDocId ? { learnDocId } : {}),
      }
    })

    setDocuments((prev) => [...prev, ...newDocuments])
    return newDocuments
  }

  const deleteDocuments = (documentIds: string[]) => {
    setDocuments((prev) => prev.filter((doc) => !documentIds.includes(doc.id)))
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
        isInitialized,
        error: seeded ? null : docsQuery.error,
        retry: docsQuery.retry,
        addDocuments,
        deleteDocuments,
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
