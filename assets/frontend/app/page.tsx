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
import { Upload, Zap, GraduationCap } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  // Study (Learn) is the front door; the four pipeline steps are grouped as
  // secondary "Manage material" actions you drop into when adding/curating content.
  const [activeTab, setActiveTab] = useState("learn");
  const primaryStep = { value: "learn", label: "Study", Icon: GraduationCap } as const;
  const materialSteps = [
    { value: "upload", label: "Upload", Icon: Upload },
    { value: "configure", label: "Process", Icon: Zap },
  ] as const;
  
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
      
      <main className="container mx-auto px-6 py-12 border-b border-border/10">
        
        <Tabs value={activeTab} className="w-full" onValueChange={setActiveTab}>
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            {/* Primary surface: Study is the front door */}
            <TabsList className="nvidia-build-tabs nvidia-build-tabs-primary" aria-label="Study">
              <TabsTrigger
                value={primaryStep.value}
                onClick={() => {
                  window.location.hash = primaryStep.value;
                  setActiveTab(primaryStep.value);
                }}
                data-value={primaryStep.value}
                className={`nvidia-build-tab nvidia-build-tab-primary ${activeTab === primaryStep.value ? 'nvidia-build-tab-active' : ''}`}
              >
                <div className="nvidia-build-tab-icon">
                  <primaryStep.Icon className="h-4 w-4 text-nvidia-green" />
                </div>
                <span>{primaryStep.label}</span>
              </TabsTrigger>
            </TabsList>

            {/* Secondary cluster: pipeline steps for adding/curating material */}
            <div className="flex flex-col gap-1.5">
              <span className="pl-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Manage material
              </span>
              <TabsList className="nvidia-build-tabs nvidia-build-tabs-secondary" aria-label="Manage material">
                {materialSteps.map(({ value, label, Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    onClick={() => {
                      window.location.hash = value;
                      setActiveTab(value);
                    }}
                    data-value={value}
                    className={`nvidia-build-tab nvidia-build-tab-sm ${activeTab === value ? 'nvidia-build-tab-active' : ''}`}
                  >
                    <div className="nvidia-build-tab-icon">
                      <Icon className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <span>{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
          
          {/* Step 1: Document Upload */}
          <TabsContent value="upload" className="nvidia-build-tab-content">
            <UploadTab onTabChange={handleTabChange} />
          </TabsContent>
          
          {/* Step 2: Configure & Process */}
          <TabsContent value="configure" className="nvidia-build-tab-content">
            <ConfigureTab />
          </TabsContent>
          
          {/* Learn (Study) — the primary surface */}
          <TabsContent value="learn" className="nvidia-build-tab-content">
            <LearnTab onTabChange={handleTabChange} />
          </TabsContent>
        </Tabs>
      </main>

      <ApiKeyPrompt />
    </div>
  )
}

