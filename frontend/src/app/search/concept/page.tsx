"use client"

import { Suspense } from "react"
import { StudyPage } from "@/kit/study"
import { ConceptAcross } from "@/surfaces/searching"

export default function Page() {
  return (
    <StudyPage wide>
      <Suspense fallback={null}>
        <ConceptAcross />
      </Suspense>
    </StudyPage>
  )
}
