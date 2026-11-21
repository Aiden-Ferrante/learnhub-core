"use client"

import { use } from "react"
import { StudyPage } from "@/kit/study"
import { TrackPage } from "@/surfaces/programs"

export default function TrackRoute({ params }: { params: Promise<{ programId: string; trackId: string }> }) {
  const { programId, trackId } = use(params)
  return (
    <StudyPage wide>
      <TrackPage programId={decodeURIComponent(programId)} trackId={decodeURIComponent(trackId)} />
    </StudyPage>
  )
}
