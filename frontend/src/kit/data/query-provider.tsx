"use client"

import type React from "react"
import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { shouldRetry } from "@/kit/data/use-api"

/** Build the app's QueryClient: data is fresh for 30 s (so moving between course pages
 *  reuses the cache), a failed read retries once unless it is a 4xx, focus refetches.
 *  A 401 is handled before react-query sees it (gateways/api/http.ts → /login). */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  })
}

/** Mounts the one QueryClient for the app. Rendered once, by app/providers.tsx. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
