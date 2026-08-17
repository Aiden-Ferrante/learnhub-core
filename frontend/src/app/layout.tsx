import type React from "react"
import type { Metadata } from "next"
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
    // No font class: the sans comes from tailwind.config's `sans`, which is the
    // fleet stack (fleet.css --fleet-font-sans). This used to load Inter, and a
    // different typeface is the loudest way one app in a fleet says it is a
    // different product.
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Follow the OS, as shipyard does. Tokens now key off
            prefers-color-scheme, so this class is cosmetic — but "dark" would
            claim the opposite of what the page renders, and would silently pin
            the app dark again if darkMode ever went back to "class". */}
        <ThemeProvider defaultTheme="system">
          <DocumentProvider>
            {/* Two tiers, matching the rest of the fleet: which app above, this
                app's own sections below. */}
            {/* No shadow: fleet.css's header is a 1px border and a blurred
                translucent ground, nothing else. The gutter is px-6, the
                fleet's 24px, and .container is now 72rem — so the header rule
                starts and stops in the same place it does in the other apps. */}
            <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
              <div className="container mx-auto px-6">
                {/* Tier heights pinned to the fleet's 38px + 49px (+1px header
                    border = 88px) — fleet.css enforces the same numbers on the
                    other four apps, so landing here no longer moves the chrome. */}
                <div className="flex h-[38px] items-end border-b border-border/60">
                  <FleetApps />
                </div>
              </div>
              <div className="container mx-auto flex h-[49px] items-center justify-between gap-4 px-6">
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