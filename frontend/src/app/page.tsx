"use client"

/** Legacy entry: the app used to be one page with #learn/#upload/#configure hash tabs.
 *  Those live at real routes now — translate old links and land on the shelf. */

import { useEffect } from "react"
import { useRouter } from "next/navigation"

const HASH_ROUTES: Record<string, string> = {
  learn: "/courses",
  upload: "/upload",
  configure: "/process",
}

export default function LegacyHashRedirect() {
  const router = useRouter()
  useEffect(() => {
    const hash = window.location.hash.replace("#", "")
    router.replace(HASH_ROUTES[hash] ?? "/courses")
  }, [router])
  return null
}
