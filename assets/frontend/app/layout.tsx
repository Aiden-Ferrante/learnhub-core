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
import { HeaderBrand, HeaderProcessLink } from "@/components/header-brand"
import { ThemeToggle } from "@/components/theme-toggle"
import { InfoModal } from "@/components/info-modal"
import { Toaster } from "@/components/ui/toaster"
import { UserMenu } from "@/components/user-menu"
import { ShortcutsHelp } from "@/components/learn/shortcuts-help"

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
              <div className="container mx-auto px-4 py-3 flex items-center justify-between">
                <HeaderBrand />
                <div className="flex items-center gap-4">
                  <HeaderProcessLink />
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