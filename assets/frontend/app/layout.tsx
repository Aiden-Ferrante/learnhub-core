//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { DocumentProvider } from "@/contexts/document-context"
import { ClientInitializer } from "@/components/client-init"
import Link from "next/link"
import { BookOpen, Search as SearchIcon } from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import { ThemeToggle } from "@/components/theme-toggle"
import { InfoModal } from "@/components/info-modal"
import { SettingsModal } from "@/components/settings-modal"
import { Toaster } from "@/components/ui/toaster"
import { UserMenu } from "@/components/user-menu"
import { ShortcutsHelp } from "@/components/learn/shortcuts-help"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: "txt2kg | Knowledge Graph Learning Studio",
  description: "Turn documents into a knowledge graph you can study — read, quiz, and master.",
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
            <ClientInitializer />
            {/* Modern Gradient Header */}
            <header className="border-b border-border/50 backdrop-blur-md dark:bg-background/95 bg-background sticky top-0 z-50 shadow-sm">
              <div className="container mx-auto px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <BrandMark className="h-8 w-8 text-nvidia-green" />
                  <div>
                    <span className="text-xl font-bold gradient-text">txt2kg</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Link
                    href="/rag"
                    className="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-2 transition-colors border border-nvidia-green/40 text-nvidia-green bg-nvidia-green/10 hover:bg-nvidia-green/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-nvidia-green/50 dark:bg-nvidia-green/20 dark:hover:bg-nvidia-green/30 dark:border-nvidia-green/50"
                  >
                    <SearchIcon className="h-4 w-4 text-current" />
                    <span>RAG Search</span>
                  </Link>
                  <Link
                    href="/#learn"
                    className="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-2 transition-colors border border-border text-foreground/90 bg-muted/40 hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-nvidia-green/50"
                  >
                    <BookOpen className="h-4 w-4 text-current" />
                    <span>Learn</span>
                  </Link>
                  <InfoModal />
                  <SettingsModal />
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