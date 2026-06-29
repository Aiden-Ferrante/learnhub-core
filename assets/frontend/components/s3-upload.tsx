//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
"use client"

import { useState } from "react"
import { Upload, AlertCircle, FileText, Loader2 } from "lucide-react"
import { uploadFileToS3 } from "@/utils/s3-storage"
import { useDocuments } from "@/contexts/document-context"
import { isSupportedIngestFile, prepareFilesForIngestion } from "@/lib/convert-pdf"
import { toast } from "@/hooks/use-toast"

export function S3Upload() {
  const { addDocuments } = useDocuments()
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validateFiles = (files: File[]): File[] => {
    setError(null)
    return Array.from(files).filter((file) => {
      if (!isSupportedIngestFile(file)) {
        setError(
          "Supported: markdown (.md), CSV (.csv), text (.txt), JSON (.json), and PDF (.pdf, converted to Markdown).",
        )
        return false
      }
      return true
    })
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
    const validFiles = validateFiles(Array.from(e.dataTransfer.files))
    if (validFiles.length > 0) {
      await uploadFiles(validFiles)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const validFiles = validateFiles(Array.from(e.target.files))
      if (validFiles.length > 0) {
        await uploadFiles(validFiles)
      }
      e.target.value = ""
    }
  }

  const uploadFiles = async (files: File[]) => {
    setIsUploading(true)
    setError(null)

    try {
      const hasPdf = files.some((f) => f.name.toLowerCase().endsWith(".pdf"))
      if (hasPdf) {
        toast({
          title: "Converting PDF",
          description: "Turning PDF into Markdown before upload…",
        })
      }
      const prepared = await prepareFilesForIngestion(files)
      addDocuments(prepared)

      for (const { file } of prepared) {
        try {
          await uploadFileToS3(file)
          toast({
            title: "File Uploaded",
            description: `${file.name} uploaded to S3 storage successfully`,
            duration: 3000,
          })
        } catch (err) {
          console.error(`Error uploading ${file.name}:`, err)
          setError(`Failed to upload ${file.name} to S3: ${err instanceof Error ? err.message : String(err)}`)
          toast({
            title: "Upload Failed",
            description: `Failed to upload ${file.name} to S3`,
            variant: "destructive",
            duration: 5000,
          })
        }
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
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div
        className={`glass-card rounded-xl p-5 text-center cursor-pointer transition-all hover-lift
                   ${isDragging ? "border-primary animate-glow" : "border-border/50"}
                   ${isUploading ? "opacity-70 cursor-not-allowed" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && document.getElementById("s3-file-upload")?.click()}
      >
        <input
          id="s3-file-upload"
          type="file"
          multiple
          className="hidden"
          accept=".md,.csv,.txt,.json,.pdf"
          onChange={handleFileSelect}
          disabled={isUploading}
        />
        <div className="flex flex-col items-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            {isUploading ? (
              <Loader2 className="h-7 w-7 text-primary animate-spin" />
            ) : (
              <Upload className="h-7 w-7 text-primary" />
            )}
          </div>
          <h3 className="text-sm font-semibold mb-1.5">
            {isUploading ? "Uploading…" : "Upload to S3"}
          </h3>
          <p className="text-xs text-muted-foreground mb-2">
            {isUploading ? (
              "Converting PDFs and uploading to S3"
            ) : (
              <>
                or <span className="font-medium text-primary">browse files</span>
              </>
            )}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-secondary/50 px-2.5 py-1 rounded-full">
            <FileText className="h-3 w-3" />
            <span>.md, .csv, .txt, .json, .pdf (auto-convert)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
