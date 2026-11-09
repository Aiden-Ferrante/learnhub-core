import type React from "react"
import type { Metadata } from "next"
import "./globals.css"
import { Inter, Newsreader } from "next/font/google"
import { DocumentProvider } from "@/surfaces/processing"
import { HeaderBrand } from "@/kit/layout/header-brand"
import { AppNav } from "@/app/_chrome/app-nav"
import { Breadcrumbs } from "@/app/_chrome/breadcrumbs"
import { InfoModal } from "@/kit/layout/info-modal"
import { Toaster } from "@/kit/ui/toaster"
import { UserMenu } from "@/app/_chrome/user-menu"
import { ShortcutsHelp } from "@/app/_chrome/shortcuts-help"
import { Providers } from "@/app/providers"

// Study Hall's two faces, self-hosted at build time: Inter for what you scan, Newsreader for
// what you read (and for page and section titles).
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" })
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif", display: "swap", style: ["normal", "italic"], axes: ["opsz"] })

export const metadata: Metadata = {
  title: "Learn Hub | Study from your textbooks",
  description: "Turn a PDF into concepts you can study — read, recall, and master.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // Dark only. LearnHub has its own look and its own one-row header since v0.29.0
    // (the fleet anchor exempts it from the shared kit and header, 2026-11-09).
    <html lang="en" className={`dark ${sans.variable} ${serif.variable}`}>
      <body>
        <Providers>
          <DocumentProvider>
            <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
              {/* 56px as a minimum, so a wrapped row on a phone grows instead of clipping. */}
              <div className="container mx-auto flex min-h-[56px] items-center justify-between gap-4 px-6">
                <div className="flex min-w-0 items-center gap-3 sm:gap-6">
                  <HeaderBrand />
                  <AppNav />
                  <Breadcrumbs />
                </div>
                <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
                  <InfoModal />
                  <UserMenu />
                </div>
              </div>
            </header>
            {children}
            <ShortcutsHelp />
            <Toaster />
          </DocumentProvider>
        </Providers>
      </body>
    </html>
  )
}