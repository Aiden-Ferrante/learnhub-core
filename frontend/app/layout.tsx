import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/layout/theme-provider"
import { DocumentProvider } from "@/features/documents/document-context"
import { HeaderBrand } from "@/components/layout/header-brand"
import { AppNav } from "@/components/layout/app-nav"
import { Breadcrumbs } from "@/components/layout/breadcrumbs"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { InfoModal } from "@/components/layout/info-modal"
import { Toaster } from "@/components/ui/toaster"
import { UserMenu } from "@/components/layout/user-menu"
import { ShortcutsHelp } from "@/features/learn/components/reader/shortcuts-help"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Learn Hub | Study from your textbooks",
  description: "Turn a PDF into concepts you can study — read, quiz, and master.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className={inter.className}>
        <ThemeProvider defaultTheme="dark">
          <DocumentProvider>
            {/* Modern Gradient Header */}
            <header className="border-b border-border/50 backdrop-blur-md dark:bg-background/95 bg-background sticky top-0 z-50 shadow-sm">
              <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <HeaderBrand />
                  <Breadcrumbs />
                </div>
                <div className="flex shrink-0 items-center gap-3">
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