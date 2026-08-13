import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/kit/layout/theme-provider"
import { DocumentProvider } from "@/surfaces/processing"
import { HeaderBrand } from "@/kit/layout/header-brand"
import { AppNav } from "@/app/_chrome/app-nav"
import { FleetApps } from "@/app/_chrome/fleet-apps"
import { Breadcrumbs } from "@/app/_chrome/breadcrumbs"
import { ThemeToggle } from "@/kit/layout/theme-toggle"
import { InfoModal } from "@/kit/layout/info-modal"
import { Toaster } from "@/kit/ui/toaster"
import { UserMenu } from "@/app/_chrome/user-menu"
import { ShortcutsHelp } from "@/app/_chrome/shortcuts-help"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

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
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className={inter.className}>
        {/* Follow the OS, as shipyard does. Tokens now key off
            prefers-color-scheme, so this class is cosmetic — but "dark" would
            claim the opposite of what the page renders, and would silently pin
            the app dark again if darkMode ever went back to "class". */}
        <ThemeProvider defaultTheme="system">
          <DocumentProvider>
            {/* Two tiers, matching the rest of the fleet: which app above, this
                app's own sections below. */}
            <header className="border-b border-border/50 backdrop-blur-md dark:bg-background/95 bg-background sticky top-0 z-50 shadow-sm">
              <div className="container mx-auto px-4">
                <div className="border-b border-border/40 pt-1.5">
                  <FleetApps />
                </div>
              </div>
              <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <HeaderBrand />
                  <Breadcrumbs />
                </div>
                <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
                  <AppNav />
                  <InfoModal />
                  <ThemeToggle />
                  <UserMenu />
                </div>
              </div>
            </header>
            {children}
            <ShortcutsHelp />
            <Toaster />
          </DocumentProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}