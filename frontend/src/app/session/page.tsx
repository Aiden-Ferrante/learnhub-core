"use client"

import { StudyPage } from "@/kit/study"
import { UpNextPlan } from "@/surfaces/library"

export default function SessionPage() {
  return (
    <StudyPage narrow>
      <UpNextPlan />
    </StudyPage>
  )
}
