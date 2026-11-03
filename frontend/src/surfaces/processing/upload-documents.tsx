"use client"

import type React from "react"

import { useRef, useState } from "react"
import { FileText, Loader2, Upload } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { cn } from "@/kit/lib/utils"
import { ErrorNotice, roots, useApiMutation, type ApiError } from "@/kit/data"
import { toast } from "@/kit/hooks/use-toast"
import { useDocuments, type DocumentAddInput } from "@/surfaces/processing/document-context"
import {
  isPdfFile,
  isSupportedIngestFile,
  loadConvertedDocument,
  markdownNameFor,
  markdownToFile,
  startPdfConversion,
} from "@/surfaces/processing/convert-pdf"

/** What starting one file's ingestion gave back: the card to add and what to tell the user. */
type Ingested = { card: DocumentAddInput; title: string; description: string }

/**
 * Start one file's ingestion: upload + enqueue only. We do NOT wait out the conversion
 * here. The card (carrying the learn-service docId) is persisted within one autosave, so
 * the book survives a reload, a closed tab, or a dropped connection; DocumentProvider
 * settles it when the job reports done.
 *
 * Every supported format goes through the conversion pipeline. There is no client-only
 * path: a card without a `learnDocId` is attached to no document, so it can never be read,
 * extracted, or studied.
 */
async function ingestOne(file: File): Promise<Ingested> {
  const fromPdf = isPdfFile(file)
  const pdfFields = fromPdf ? { convertedFromPdf: true, originalPdfName: file.name } : {}
  const start = await startPdfConversion(file)

  if (start.kind === "job") {
    return {
      card: { file, name: markdownNameFor(file.name), converting: true, ...pdfFields, learnDocId: start.docId },
      title: fromPdf ? "Converting PDF" : "Importing Markdown",
      description: `"${file.name}" is processing in the background — it stays in your library even if you leave this page.`,
    }
  }

  // Already ingested, or an older synchronous server: content is available now.
  const result =
    start.kind === "duplicate" ? await loadConvertedDocument(start.docId, file.name, start.existingTitle) : start.result
  return {
    card: {
      file: markdownToFile(result.markdown, result.outputFilename),
      ...pdfFields,
      pageCount: result.pageCount,
      learnDocId: result.learnDocId,
      duplicateOf: result.duplicateOf,
    },
    ...(result.duplicateOf
      ? {
          title: "Already in your library",
          description: `"${file.name}" matches an existing book — linked to its content instead of converting a second copy.`,
        }
      : {
          title: fromPdf ? "PDF converted" : "Markdown imported",
          description: `"${file.name}" is ready to read.`,
        }),
  }
}

export function UploadDocuments() {
  const { addDocuments } = useDocuments()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [invalid, setInvalid] = useState(false)
  // Every file that failed to start in the last drop, with its reason. A later file
  // succeeding resets the mutation's own error, so the failures are kept here.
  const [failed, setFailed] = useState<{ file: File; error: ApiError }[]>([])

  const ingest = useApiMutation(ingestOne, {
    invalidates: [roots.learnDocuments],
    onSuccess: (r) => {
      addDocuments([r.card])
      toast({ title: r.title, description: r.description })
    },
    onError: (error, file) => setFailed((prev) => [...prev, { file, error }]),
  })

  // One file at a time, in order; a failure names its file and the rest still go.
  const ingestFiles = async (files: File[]) => {
    const valid = files.filter(isSupportedIngestFile)
    setInvalid(valid.length < files.length)
    setFailed([])
    for (const file of valid) {
      // A failure lands in `failed` through onError and is shown below with a Retry;
      // awaiting the outcome here only keeps the files in order.
      await ingest.run(file).then(
        () => true,
        () => false,
      )
    }
  }

  const busy = ingest.pending
  const browse = () => !busy && inputRef.current?.click()

  return (
    <div className="space-y-4">
      {invalid && (
        <p role="alert" className="text-meta text-ink-danger">
          Supported: PDF (.pdf, converted to Markdown) and Markdown (.md). Other files were skipped.
        </p>
      )}
      {failed.map(({ file, error }) => (
        <ErrorNotice
          key={file.name}
          compact
          title={`Not uploaded: ${file.name}`}
          error={error}
          onRetry={() => {
            setFailed((prev) => prev.filter((f) => f.file !== file))
            ingest.fire(file)
          }}
        />
      ))}

      <div
        className={cn(
          "relative rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          busy ? "cursor-wait opacity-70" : "cursor-pointer hover:border-ring hover:bg-muted/40",
          isDragging ? "border-ring bg-muted/60" : "border-border",
        )}
        onDragOver={(e: React.DragEvent) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e: React.DragEvent) => {
          e.preventDefault()
          setIsDragging(false)
          void ingestFiles(Array.from(e.dataTransfer.files))
        }}
        onClick={browse}
      >
        <input
          ref={inputRef}
          id="file-upload"
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.md,.markdown"
          disabled={busy}
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : []
            e.target.value = ""
            void ingestFiles(files)
          }}
        />
        <div className="flex flex-col items-center gap-2">
          {busy ? (
            <Loader2 className="h-8 w-8 animate-spin text-ink-accent" />
          ) : (
            <Upload className="h-8 w-8 text-ink-accent" />
          )}
          <h3 className="text-title font-semibold text-foreground">{busy ? "Uploading…" : "Drag & drop files"}</h3>
          <p className="text-meta text-muted-foreground">
            {busy ? (
              "Conversion continues in the background once the upload finishes"
            ) : (
              <>
                or{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-meta text-ink-accent"
                  onClick={(e) => {
                    e.stopPropagation()
                    browse()
                  }}
                >
                  browse files
                </Button>
              </>
            )}
          </p>
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-micro text-muted-foreground">
            <FileText className="h-3 w-3" />
            .pdf (auto-convert), .md
          </span>
        </div>
      </div>
    </div>
  )
}
