"use client"

import { usePathname, useRouter } from "next/navigation"
import { Zap } from "lucide-react"
import { BrandMark } from "@/components/layout/brand-mark"

/** Clickable site brand: always returns to the course shelf. When already on the Learn
 *  tab the hash doesn't change (no hashchange event), so we also broadcast a home event
 *  that LearnTab listens for to reset its internal view. */
export function HeaderBrand() {
  const router = useRouter()
  const pathname = usePathname()

  const goHome = () => {
    if (pathname !== "/") {
      router.push("/#learn")
      return
    }
    window.location.hash = "learn"
    window.dispatchEvent(new Event("learnhub:home"))
  }

  return (
    <button
      type="button"
      onClick={goHome}
      aria-label="Learn Hub home"
      className="flex items-center gap-3 rounded-lg transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand/50"
    >
      <BrandMark className="h-8 w-8 text-brand" />
      <span className="text-xl font-bold gradient-text">Learn Hub</span>
    </button>
  )
}

/** Header link to the Process tab. Assigning location.hash (unlike a Next Link's
 *  pushState) fires hashchange, which is what the home page's tab switcher listens for. */
export function HeaderProcessLink() {
  const router = useRouter()
  const pathname = usePathname()

  const goProcess = () => {
    if (pathname !== "/") {
      router.push("/#configure")
      return
    }
    window.location.hash = "configure"
  }

  return (
    <button
      type="button"
      onClick={goProcess}
      className="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-2 transition-colors border border-border text-foreground/90 bg-muted/40 hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand/50"
    >
      <Zap className="h-4 w-4 text-current" />
      <span>Process</span>
    </button>
  )
}
