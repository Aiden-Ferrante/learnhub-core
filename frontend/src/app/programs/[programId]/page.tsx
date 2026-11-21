"use client"

import { use } from "react"
import { StudyPage } from "@/kit/study"
import { ProgramPage } from "@/surfaces/programs"

export default function ProgramRoute({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = use(params)
  return (
    <StudyPage wide>
      <ProgramPage programId={decodeURIComponent(programId)} />
    </StudyPage>
  )
}
