"use client"

import type React from "react"

import { useState } from "react"
import { Upload, AlertCircle, FileText, Loader2 } from "lucide-react"
import { useDocuments } from "@/surfaces/processing/document-context"
import {
  isPdfFile,
  isSupportedIngestFile,
  loadConvertedDocument,
  markdownNameFor,
  markdownToFile,
  startPdfConversion,
} from "@/surfaces/processing/convert-pdf"
import { toast } from "@/kit/hooks/use-toast"

export function UploadDocuments() {
  const { addDocuments } = useDocuments()
  const [isDragging, setIsDragging] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validateFiles = (files: File[]): File[] => {
    setError(null)
    const validFiles = Array.from(files).filter((file) => {
      if (!isSupportedIngestFile(file)) {
        setError(
          "Supported: PDF (.pdf, converted to Markdown) and Markdown (.md).",
        )
        return false
      }
      return true
    })
    return validFiles
  }

  /**
   * Start each file's ingestion and give it a card straight away. That means upload +
   * enqueue only — we do NOT wait out the conversion here. The card (carrying the
   * learn-service docId) is persisted within one autosave, so the book survives a
   * reload, a closed tab, or a dropped connection; DocumentProvider settles it when the
   * job reports done.
   */
  const ingestFiles = async (files: File[]) => {
    const validFiles = validateFiles(files)
    if (validFiles.length === 0) return

    // Every supported format goes through the conversion pipeline. There is no
    // client-only path: a card without a `learnDocId` is attached to no document, so it
    // can never be read, extracted, or studied.
    setIsConverting(true)
    setError(null)
    try {
      for (const file of validFiles) {
        const fromPdf = isPdfFile(file)
        try {
          const start = await startPdfConversion(file)

          if (start.kind === "job") {
            addDocuments([
              {
                file,
                name: markdownNameFor(file.name),
                converting: true,
                ...(fromPdf ? { convertedFromPdf: true, originalPdfName: file.name } : {}),
                learnDocId: start.docId,
              },
            ])
            toast({
              title: fromPdf ? "Converting PDF" : "Importing Markdown",
              description: `"${file.name}" is processing in the background — it stays in your library even if you leave this page.`,
            })
            continue
          }

          // Already ingested, or an older synchronous server: content is available now.
          const result =
            start.kind === "duplicate"
              ? await loadConvertedDocument(start.docId, file.name, start.existingTitle)
              : start.result
          addDocuments([
            {
              file: markdownToFile(result.markdown, result.outputFilename),
              ...(fromPdf ? { convertedFromPdf: true, originalPdfName: file.name } : {}),
              pageCount: result.pageCount,
              learnDocId: result.learnDocId,
              duplicateOf: result.duplicateOf,
            },
          ])
          toast(
            result.duplicateOf
              ? {
                  title: "Already in your library",
                  description: `"${file.name}" matches an existing book — linked to its content instead of converting a second copy.`,
                }
              : {
                  title: fromPdf ? "PDF converted" : "Markdown imported",
                  description: `"${file.name}" is ready to read.`,
                },
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          setError(message)
          toast({
            title: `Could not start "${file.name}"`,
            description: message,
            variant: "destructive",
          })
        }
      }
    } finally {
      setIsConverting(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    await ingestFiles(Array.from(e.dataTransfer.files))
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await ingestFiles(Array.from(e.target.files))
      e.target.value = ""
    }
  }

  const busy = isConverting

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200
                   ${busy ? "opacity-70 cursor-wait" : "cursor-pointer hover:border-brand/50 hover:bg-brand/5"}
                   ${isDragging ? "border-brand bg-brand/10 scale-[1.02]" : "border-border/40 hover:border-brand/40"}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !busy && document.getElementById("file-upload")?.click()}
      >
        <input
          id="file-upload"
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.md,.markdown"
          onChange={handleFileSelect}
          disabled={busy}
        />
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center mb-4 border border-brand/20">
            {busy ? (
              <Loader2 className="h-8 w-8 text-brand animate-spin" />
            ) : (
              <Upload className="h-8 w-8 text-brand" />
            )}
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {busy ? "Uploading…" : "Drag & Drop Files"}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {busy ? (
              "Conversion continues in the background once the upload finishes"
            ) : (
              <>
                or <button type="button" className="font-medium text-brand hover:text-brand/80 underline underline-offset-2">browse files</button>
              </>
            )}
          </p>
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-full border border-border/30">
            <FileText className="h-3 w-3" />
            <span>.pdf (auto-convert), .md</span>
          </div>
        </div>
      </div>
    </div>
  )
}
