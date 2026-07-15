"use client"

import { useRouter } from "next/navigation"
import { UploadTab } from "@/features/documents/components/upload-tab"

export default function UploadPage() {
  const router = useRouter()
  // UploadTab still speaks the old tab vocabulary; translate it to routes.
  const onTabChange = (tab: string) => {
    router.push(tab === "configure" ? "/process" : tab === "upload" ? "/upload" : "/courses")
  }
  return (
    <main className="container mx-auto px-6 py-6">
      <UploadTab onTabChange={onTabChange} />
    </main>
  )
}
