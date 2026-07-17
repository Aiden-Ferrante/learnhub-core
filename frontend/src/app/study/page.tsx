"use client"

import { useRouter } from "next/navigation"
import { StudyPlanner } from "@/surfaces/studying"

export default function StudyPage() {
  const router = useRouter()
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-6 pt-3">
      <StudyPlanner onOpenCourse={(doc) => router.push(`/courses/${doc}`)} />
    </main>
  )
}
