"use client"

import { Suspense } from "react"
import { StudyPage } from "@/kit/study"
import { PickedReview } from "@/surfaces/searching"

export default function Page() {
  return (
    <StudyPage narrow>
      <Suspense fallback={null}>
        <PickedReview />
      </Suspense>
    </StudyPage>
  )
}
