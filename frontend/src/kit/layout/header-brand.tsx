"use client"

import Link from "next/link"
import { BrandMark } from "@/kit/layout/brand-mark"

/** Clickable site brand: always returns to the course shelf. */
export function HeaderBrand() {
  return (
    <Link
      href="/courses"
      aria-label="Learn Hub home"
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <BrandMark className="h-5 w-5 text-brand" />
      <span className="font-serif text-[1.25rem] font-semibold tracking-tight text-foreground">Learn Hub</span>
    </Link>
  )
}
