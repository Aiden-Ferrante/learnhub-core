"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ExternalLink, FileText, Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { BookReader } from "@/surfaces/reading/book-reader"
import { type LearnTreeNode } from "@/gateways/api/outline"
import { type MasteryResponse } from "@/gateways/api/progress"
import type { Course } from "@/surfaces/library"

type PdfBookViewProps = {
  course: Course
  tree: LearnTreeNode[]
  loading: boolean
  mastery: MasteryResponse | null
  onBack: () => void
  onSectionRead?: (sectionKey: string) => void
}

/** "Read the book" = the ORIGINAL PDF, untouched, in the browser's native viewer — so a
 *  reader can always verify what the pipeline extracted against the source of truth.
 *  Full-screen and pop-out-window modes included. Documents ingested from non-PDF
 *  sources fall back to the markdown chapter reader. */
export function PdfBookView({ course, tree, loading, mastery, onBack, onSectionRead }: PdfBookViewProps) {
  const docId = course.learnDocId ?? course.id
  const pdfUrl = `/api/learn/pdf?doc=${encodeURIComponent(docId)}`
  const [avail, setAvail] = useState<"checking" | "yes" | "no">("checking")
  const [isFull, setIsFull] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    fetch(pdfUrl, { method: "HEAD", cache: "no-store" })
      .then((r) => alive && setAvail(r.ok ? "yes" : "no"))
      .catch(() => alive && setAvail("no"))
    return () => {
      alive = false
    }
  }, [pdfUrl])

  // Pin the surface to the viewport (the app shell page-scrolls; same trick as the
  // deep chapter) so the PDF pane owns the full height.
  useEffect(() => {
    if (avail !== "yes") return
    const el = rootRef.current
    if (!el) return
    const size = () => {
      window.scrollTo(0, 0)
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top))
      el.style.height = `calc(100dvh - ${top}px - 12px)`
    }
    size()
    window.addEventListener("resize", size)
    return () => window.removeEventListener("resize", size)
  }, [avail])

  // Track native fullscreen so the toggle button stays honest (Esc exits too).
  useEffect(() => {
    const sync = () => setIsFull(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", sync)
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      rootRef.current?.requestFullscreen().catch(() => {})
    }
  }

  const openWindow = () => {
    window.open(pdfUrl, "_blank", "noopener,width=1200,height=950")
  }

  if (avail === "checking") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    )
  }

  // No original PDF (e.g. a markdown/txt ingest) — the chapter reader remains the read path.
  if (avail === "no") {
    return (
      <BookReader
        course={course}
        tree={tree}
        loading={loading}
        mastery={mastery}
        onBack={onBack}
        onSectionRead={onSectionRead}
      />
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b bg-card/80 px-3 py-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to course
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={course.title}>
          {course.title}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
          <FileText className="h-3 w-3" />
          Original PDF
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={openWindow}
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
      <iframe
        src={pdfUrl}
        title={`${course.title} — original PDF`}
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  )
}
