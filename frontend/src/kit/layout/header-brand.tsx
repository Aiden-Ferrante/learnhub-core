"use client"

import Link from "next/link"
import { BrandMark } from "@/kit/layout/brand-mark"

/** Clickable site brand: always returns to the course shelf. */
export function HeaderBrand() {
  return (
    <Link
      href="/courses"
      aria-label="Learn Hub home"
      className="flex items-center gap-2 rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      {/* The .fleet-brand treatment: 15px / 600 / -0.01em, in the ink colour.
          It was 20px bold in a blue gradient — the fleet's other four wordmarks
          are the quietest thing in the header, because the row above already
          says which app you are in. The mark shrinks to match. */}
      <BrandMark className="h-5 w-5 text-brand" />
      <span className="text-title font-semibold tracking-tight text-foreground">Learn Hub</span>
    </Link>
  )
}
