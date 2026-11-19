"use client"

/** The Desk (v0.30.0): the frame every course route renders inside — now just the course
 *  title on top, back to the chapter cards. The mode bar went in v0.31.4 and the chapter rail
 *  down the left in v0.31.5 (human, 2026-11-19): the chapter cards and hubs are the navigation. */

import Link from "next/link"
import type React from "react"
import { cleanCourseTitle } from "@/kit/lib/course-title"
import { coverColor } from "@/surfaces/library/cover"
import { useCourseData } from "@/surfaces/library/use-course-data"

export function CourseDesk({ courseId, children }: { courseId: string; children: React.ReactNode }) {
  const data = useCourseData(courseId)
  if (!data.course) return <>{children}</>

  const base = `/courses/${courseId}`
  const title = cleanCourseTitle(data.course.title).title

  return (
    <div className="desk">
      <div className="border-b border-border bg-card/60">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5">
          <Link href={base} className="flex min-w-0 max-w-[28rem] items-center gap-2.5 font-serif text-section font-semibold text-foreground">
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: coverColor(title) }} />
            <span className="truncate">{title}</span>
          </Link>
        </div>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  )
}
