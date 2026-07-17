"use client"

import Link from "next/link"
import { BrandMark } from "@/kit/layout/brand-mark"

/** Clickable site brand: always returns to the course shelf. */
export function HeaderBrand() {
  return (
    <Link
      href="/courses"
      aria-label="Learn Hub home"
      className="flex items-center gap-3 rounded-lg transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand/50"
    >
      <BrandMark className="h-8 w-8 text-brand" />
      <span className="text-xl font-bold gradient-text">Learn Hub</span>
    </Link>
  )
}
