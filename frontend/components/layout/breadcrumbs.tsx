"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { useDocuments } from "@/features/documents/document-context"
import { cleanCourseTitle } from "@/features/learn/lib/courses"

const SUBPAGE_LABELS: Record<string, string> = {
  chapter: "Chapter",
  concepts: "Concepts",
  drill: "Drill",
  dump: "Free recall",
  ask: "Ask",
  read: "Book",
}

/** "Courses › <title> › <surface>" in the header on course routes; empty elsewhere. */
export function Breadcrumbs() {
  const pathname = usePathname()
  const { documents } = useDocuments()

  const segments = pathname.split("/").filter(Boolean)
  if (segments[0] !== "courses" || segments.length < 2) return null

  const courseId = decodeURIComponent(segments[1])
  const doc = documents.find((d) => d.id === courseId)
  const title = doc ? cleanCourseTitle(doc.name).title : null
  const subpage = segments[2] ? SUBPAGE_LABELS[segments[2]] : null

  return (
    <div className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground md:flex">
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      <Link href="/courses" className="shrink-0 transition-colors hover:text-foreground">
        Courses
      </Link>
      {title && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <Link
            href={`/courses/${courseId}`}
            className="max-w-[28ch] truncate transition-colors hover:text-foreground"
            title={title}
          >
            {title}
          </Link>
        </>
      )}
      {subpage && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <span className="shrink-0 text-foreground/80">{subpage}</span>
        </>
      )}
    </div>
  )
}
