"use client"

import { use } from "react"
import type React from "react"
import { CourseDesk } from "@/surfaces/library"

/** Every course route sits on the Desk (v0.30.0): the mode bar and the chapter rail. */
export default function CourseLayout({
  params,
  children,
}: {
  params: Promise<{ courseId: string }>
  children: React.ReactNode
}) {
  const { courseId } = use(params)
  return <CourseDesk courseId={courseId}>{children}</CourseDesk>
}
