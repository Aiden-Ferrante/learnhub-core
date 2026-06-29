//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { TocSectionSelector } from "@/components/toc-section-selector"
import type { TocAnalysisResult } from "@/utils/toc-processing"
import {
  inferTocViaApi,
  isLlmTocFallbackEnabled,
  setLlmTocFallbackEnabled,
  tocSourceDescription,
  tocSourceLabel,
} from "@/lib/toc-preview-helpers"

type TocPreviewDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  docName: string
  analysis: TocAnalysisResult | null
  documentText: string
  onAnalysisChange: (analysis: TocAnalysisResult) => void
  selectedKeys?: string[]
  onSelectionChange?: (keys: string[] | undefined) => void
}

export function TocPreviewDialog({
  open,
  onOpenChange,
  docName,
  analysis,
  documentText,
  onAnalysisChange,
  selectedKeys,
  onSelectionChange = () => {},
}: TocPreviewDialogProps) {
  const { toast } = useToast()
  const [inferLoading, setInferLoading] = useState(false)
  const [llmFallback, setLlmFallback] = useState(() => isLlmTocFallbackEnabled())
  const [rawPreviewOpen, setRawPreviewOpen] = useState(false)

  const handleLlmFallbackChange = (checked: boolean) => {
    setLlmFallback(checked)
    setLlmTocFallbackEnabled(checked)
  }

  const handleInferToc = async () => {
    if (!documentText.trim()) return
    setInferLoading(true)
    try {
      const result = await inferTocViaApi(documentText)
      onAnalysisChange(result)
      onSelectionChange(undefined)
      toast({
        title: "TOC inferred",
        description: `${result.entryCount} section(s) detected via LLM.`,
      })
    } catch (e) {
      toast({
        title: "TOC inference failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setInferLoading(false)
    }
  }

  const hasEntries = analysis != null && analysis.entries.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4 pr-12">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            TOC detection: {docName}
            {analysis && analysis.source !== "none" && (
              <Badge variant="secondary">{tocSourceLabel(analysis.source)}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {analysis ? tocSourceDescription(analysis.source) : "Analyzing document structure…"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {hasEntries ? (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Sections to extract</Label>
              <p className="text-xs text-muted-foreground">
                Showing all {analysis.entryCount} sections. Unchecked sections keep outline
                structure in the graph but skip LLM extraction.
              </p>
              <TocSectionSelector
                entries={analysis.entries}
                selectedKeys={selectedKeys}
                onSelectionChange={onSelectionChange}
                listClassName="max-h-none"
              />
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm text-muted-foreground">
                No outline detected — entire document will be processed.
              </p>
              <pre className="mt-2 text-xs sm:text-sm font-mono whitespace-pre-wrap text-foreground leading-relaxed">
                {analysis?.lines.join("\n")}
              </pre>
            </div>
          )}

          {hasEntries ? (
            <div className="mt-4">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setRawPreviewOpen((v) => !v)}
              >
                {rawPreviewOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Raw preview ({analysis.entryCount} entries)
              </button>
              {rawPreviewOpen ? (
                <div className="mt-2 rounded-md border bg-muted/30 p-3">
                  <pre className="text-xs font-mono whitespace-pre-wrap text-foreground leading-relaxed">
                    {analysis.lines.join("\n")}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}

          {documentText.trim() && (
            <div className="mt-4 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleInferToc}
                disabled={inferLoading}
                className="gap-2"
              >
                {inferLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {hasEntries ? "Re-detect TOC with LLM" : "Infer TOC with LLM"}
              </Button>
              {hasEntries && (
                <span className="text-xs text-muted-foreground">
                  Headings look wrong or incomplete? Let the model rebuild the outline.
                </span>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t px-6 py-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id="llm-toc-fallback"
              checked={llmFallback}
              onCheckedChange={(v) => handleLlmFallbackChange(v === true)}
            />
            <Label htmlFor="llm-toc-fallback" className="text-sm leading-snug cursor-pointer">
              Use LLM TOC fallback during extraction when heuristics find no outline
            </Label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function countSelectedSections(
  entries: TocAnalysisResult["entries"],
  selectedKeys?: string[],
): { selected: number; total: number } {
  const total = entries.length
  if (total === 0) return { selected: 0, total: 0 }
  if (selectedKeys === undefined) return { selected: total, total }
  return { selected: selectedKeys.length, total }
}

export function hasZeroSectionsSelected(
  analysis: TocAnalysisResult | null,
  selectedKeys?: string[],
): boolean {
  if (!analysis || analysis.entries.length === 0) return false
  if (selectedKeys === undefined) return false
  return selectedKeys.length === 0
}
