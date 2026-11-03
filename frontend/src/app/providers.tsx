"use client"

import type React from "react"
import { QueryProvider } from "@/kit/data/query-provider"

/** Client-side providers for the root layout. One QueryClient for the whole app; the
 *  DocumentProvider (which reads through it) sits inside, in layout.tsx. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>
}
