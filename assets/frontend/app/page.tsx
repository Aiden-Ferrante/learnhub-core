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
"use client"

import { useState, useEffect } from "react"
import { ApiKeyPrompt } from "@/components/api-key-prompt"
import { ChevronLeft } from "lucide-react"
import React from "react"
import { UploadTab } from "@/components/tabs/UploadTab"
import { ConfigureTab } from "@/components/tabs/ConfigureTab"
import { LearnTab } from "@/components/tabs/LearnTab"
// EditTab (TripleViewer) and VisualizeTab (KnowledgeGraphViewer) are intentionally unwired
// from the nav — they serve the paused triple/KG direction. Code is kept on disk to later
// repurpose the graph viz for the concept prerequisite DAG.

// Add global styles for dropdown visibility
const globalStyles = `
  .model-dropdown {
    position: relative;
    z-index: 9999;
  }
  .model-dropdown-menu {
    z-index: 9999;
  }
`;

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
    <div className="min-h-screen bg-background text-foreground">
      {/* Add style element for global styles */}
      <style dangerouslySetInnerHTML={{ __html: globalStyles }} />
      
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
          {activeTab === "upload" ? <UploadTab onTabChange={handleTabChange} /> : <ConfigureTab />}
        </main>
      )}

      <ApiKeyPrompt />
    </div>
  )
}

