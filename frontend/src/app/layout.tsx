import type React from "react"
import type { Metadata } from "next"
import "./globals.css"
import { DocumentProvider } from "@/surfaces/processing"
import { HeaderBrand } from "@/kit/layout/header-brand"
import { AppNav } from "@/app/_chrome/app-nav"
import { FleetApps } from "@/app/_chrome/fleet-apps"
import { Breadcrumbs } from "@/app/_chrome/breadcrumbs"
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
    // The sans is the fleet's (Geist, self-hosted under /fleet-fonts, declared
    // in globals.css and tailwind.config's `sans`); dark only, with the fleet.
    <html lang="en" className="dark">
      <body>
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
                    border = 88px) — as MINIMUMS, like fleet.css: a wrapped tier
                    on a narrow screen grows instead of clipping. */}
                <div className="flex min-h-[38px] items-center border-b border-border/60">
                  <FleetApps />
                </div>
              </div>
              <div className="container mx-auto flex min-h-[49px] items-center justify-between gap-4 px-6">
                {/* Sections sit LEFT, after the brand, where the other five apps
                    put them (.fleet-nav); the right keeps actions only. */}
                <div className="flex min-w-0 items-center gap-2 sm:gap-4">
                  <HeaderBrand />
                  <Breadcrumbs />
                  <AppNav />
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
      </body>
    </html>
  )
}