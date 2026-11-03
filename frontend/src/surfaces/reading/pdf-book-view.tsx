"use client"

import { useEffect, useRef, useState } from "react"
import { ExternalLink, FileText, Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { qk, useApi, AsyncView } from "@/kit/data"
import { BookReader } from "@/surfaces/reading/book-reader"
import { useViewportPin } from "@/surfaces/reading/use-viewport-pin"
import { fetchOriginalPdfAvailable, originalPdfUrl } from "@/gateways/api/content"
import { type LearnTreeNode } from "@/gateways/api/outline"
import { type MasteryResponse } from "@/gateways/api/progress"
import type { Course } from "@/surfaces/library"

type PdfBookViewProps = {
  course: Course
  tree: LearnTreeNode[]
  loading: boolean
  mastery: MasteryResponse | null
  onSectionRead?: (sectionKey: string) => void
}

function PdfSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading the book">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-[60vh] w-full" />
    </div>
  )
}

/** "Read the book" = the ORIGINAL PDF, untouched, in the browser's native viewer, so a
 *  reader can always verify what the pipeline extracted against the source of truth.
 *  Full-screen and pop-out-window modes included. Documents ingested from non-PDF
 *  sources fall back to the markdown book reader. Back to the course is the breadcrumb. */
export function PdfBookView({ course, tree, loading, mastery, onSectionRead }: PdfBookViewProps) {
  const docId = course.learnDocId ?? course.id
  const pdfUrl = originalPdfUrl(docId)
  const avail = useApi(qk.pdf(pdfUrl), (signal) => fetchOriginalPdfAvailable(docId, signal))

  return (
    <AsyncView q={avail} skeleton={<PdfSkeleton />} errorTitle="Couldn't open the book">
      {(hasPdf) =>
        hasPdf ? (
          <PdfPane title={course.title} pdfUrl={pdfUrl} />
        ) : (
          // No original PDF (e.g. a markdown/txt ingest): the chapter reader is the read path.
          <BookReader course={course} tree={tree} loading={loading} mastery={mastery} onSectionRead={onSectionRead} />
        )
      }
    </AsyncView>
  )
}

/** The native PDF viewer pinned to the viewport, with Window and Full screen. */
function PdfPane({ title, pdfUrl }: { title: string; pdfUrl: string }) {
  const [isFull, setIsFull] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useViewportPin(rootRef)

  // Track native fullscreen so the toggle button stays honest (Esc exits too).
  useEffect(() => {
    const sync = () => setIsFull(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", sync)
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [])

  const toggleFullscreen = () => {
    // A refused fullscreen request (no user gesture, iframe policy) leaves the page as it
    // was, which is the right outcome; fullscreenchange keeps the button honest.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void rootRef.current?.requestFullscreen().catch(() => undefined)
  }

  return (
    <div ref={rootRef} className="flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b bg-card/80 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-micro text-ink-accent">
          <FileText className="h-3 w-3" />
          Original PDF
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => window.open(pdfUrl, "_blank", "noopener,width=1200,height=950")}
          title="Open the PDF in its own window"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Window
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={toggleFullscreen}
          title={isFull ? "Exit full screen" : "Full screen"}
        >
          {isFull ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {isFull ? "Exit" : "Full screen"}
        </Button>
      </div>
      <iframe src={pdfUrl} title={`${title} — original PDF`} className="min-h-0 w-full flex-1 border-0 bg-background" />
    </div>
  )
}
