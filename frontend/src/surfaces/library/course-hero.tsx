"use client"

import Link from "next/link"
import { BookOpen, GraduationCap, RotateCcw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { Sheet } from "@/kit/study"
import type { Course } from "@/surfaces/library/courses"
import type { NextStep } from "@/surfaces/library/use-next-step"

const STEP_ICON = { review: RotateCcw, pack: GraduationCap, read: BookOpen } as const

/** The top of the course home: the title and ONE primary button, picked by the shared
 *  next-step rule (Review → pack → reading). */
export function CourseHero({ course, step }: { course: Course; step: NextStep | null }) {
  const Icon = step ? STEP_ICON[step.kind] : null
  return (
    <Sheet as="div">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-page font-semibold tracking-tight">{course.title}</h1>
          <p className="mt-0.5 text-meta text-muted-foreground">{course.description}</p>
        </div>
        {step && Icon ? (
          <Button asChild>
            <Link href={step.href}>
              <Icon />
              <span className="max-w-[28rem] truncate">{step.label}</span>
            </Link>
          </Button>
        ) : (
          <Skeleton className="h-10 w-44" aria-label="Working out the next step" />
        )}
      </div>
    </Sheet>
  )
}
