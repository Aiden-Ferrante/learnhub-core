"use client"

import type React from "react"

import { useState } from "react"
import { Upload, AlertCircle, FileText, Loader2 } from "lucide-react"
import { useDocuments } from "@/features/documents/document-context"
import { isSupportedIngestFile, prepareFilesForIngestion } from "@/features/documents/lib/convert-pdf"
import { toast } from "@/hooks/use-toast"

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
          "Supported: markdown (.md), CSV (.csv), text (.txt), JSON (.json), and PDF (.pdf, converted to Markdown).",
        )
        return false
      }
      return true
    })
    return validFiles
  }

  const ingestFiles = async (files: File[]) => {
    const validFiles = validateFiles(files)
    if (validFiles.length === 0) return

    const hasPdf = validFiles.some((f) => f.name.toLowerCase().endsWith(".pdf"))
    setIsConverting(true)
    setError(null)

    try {
      if (hasPdf) {
        toast({
          title: "Converting PDF",
          description: "Turning PDF into Markdown for ingestion…",
        })
      }
      const prepared = await prepareFilesForIngestion(validFiles)
      addDocuments(prepared)
      const duplicates = prepared.filter((p) => p.duplicateOf)
      for (const d of duplicates) {
        toast({
          title: "Already in your library",
          description: `"${d.originalPdfName}" matches an existing book — linked to its content instead of converting a second copy.`,
        })
      }
      const converted = prepared.filter((p) => p.convertedFromPdf && !p.duplicateOf)
      if (converted.length > 0) {
        toast({
          title: "PDF converted",
          description: `${converted.length} file(s) ready as Markdown. Use Preview TOC before processing if you need section hierarchy.`,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast({
        title: "PDF conversion failed",
        description: message,
        variant: "destructive",
      })
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
          accept=".md,.csv,.txt,.json,.pdf"
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
            {busy ? "Converting PDF…" : "Drag & Drop Files"}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {busy ? (
              "Please wait while PDFs are converted to Markdown"
            ) : (
              <>
                or <button type="button" className="font-medium text-brand hover:text-brand/80 underline underline-offset-2">browse files</button>
              </>
            )}
          </p>
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-full border border-border/30">
            <FileText className="h-3 w-3" />
            <span>.md, .csv, .txt, .json, .pdf (auto-convert)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
