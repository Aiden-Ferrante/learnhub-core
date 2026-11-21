"use client"

import { Suspense } from "react"
import { StudyPage } from "@/kit/study"
import { SearchResults } from "@/surfaces/searching"

export default function Page() {
  return (
    <StudyPage wide>
      <Suspense fallback={null}>
        <SearchResults />
      </Suspense>
    </StudyPage>
  )
}
