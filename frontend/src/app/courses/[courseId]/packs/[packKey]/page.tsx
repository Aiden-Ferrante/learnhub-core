"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { PackView } from "@/surfaces/practicing"

export default function PackPage({ params }: { params: Promise<{ courseId: string; packKey: string }> }) {
  const { courseId, packKey } = use(params)
  const router = useRouter()
  return <PackView packKey={packKey} onBack={() => router.push(`/courses/${courseId}/packs`)} />
}
