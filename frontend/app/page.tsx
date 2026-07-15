"use client"

import { useState, useEffect } from "react"
import { ChevronLeft } from "lucide-react"
import React from "react"
import { UploadTab } from "@/features/documents/components/upload-tab"
import { ProcessTab } from "@/features/process/components/process-tab"
import { LearnTab } from "@/features/learn/components/learn-tab"

export default function Home() {
  // Study (Learn) IS the app — no tab chrome; the learning surface gets the whole
  // screen. Upload/Process are reachable from the course shelf and render as
  // sub-pages with a slim back bar.
  const [activeTab, setActiveTab] = useState("learn");

  // Controlled-tab switch: update state (and URL hash) directly.
  const handleTabChange = React.useCallback((tab: string) => {
    window.location.hash = tab;
    setActiveTab(tab);
  }, []);
  
  // Handle tab selection based on URL hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (['upload', 'configure', 'learn'].includes(hash)) {
        handleTabChange(hash);
        setActiveTab(hash);
      }
    }
    
    // Set hash on initial load if not present
    if (!window.location.hash) {
      window.location.hash = 'learn';
    } else {
      handleHashChange();
    }
    
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [handleTabChange]);
  
  return (
    // No min-h-screen: the sticky header sits above this in flow, so viewport-height
    // here forces 63px of dead scroll under every viewport-pinned view (PDF read, deep
    // chapter). The body carries the background, so nothing is lost visually.
    <div className="bg-background text-foreground">
      {activeTab === "learn" ? (
        // The learning pipeline owns the whole screen below the site banner.
        <main className="mx-auto w-full px-4 pb-3 pt-3">
          <LearnTab onTabChange={handleTabChange} />
        </main>
      ) : (
        <main className="container mx-auto px-6 py-6">
          <button
            type="button"
            onClick={() => handleTabChange("learn")}
            className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to courses
          </button>
          {activeTab === "upload" ? <UploadTab onTabChange={handleTabChange} /> : <ProcessTab />}
        </main>
      )}
    </div>
  )
}

