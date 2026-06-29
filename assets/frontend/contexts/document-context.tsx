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

import type React from "react"

import { createContext, useContext, useState, useEffect, useRef } from "react"
import { type Triple, triplesToGraph } from "@/utils/text-processing"
import { extractDocumentWithOptionalToc } from "@/utils/toc-processing"
import { resolveTocForExtraction } from "@/lib/toc-preview-helpers"
import { toast } from "@/hooks/use-toast"
import { type PromptConfigurations } from "@/components/prompt-configuration"
import type { PreparedIngestFile } from "@/lib/convert-pdf"
import {
  startExtraction,
  getExtractionStatus,
  type ExtractStatusResponse,
} from "@/lib/learn-service"

export type DocumentAddInput = File | PreparedIngestFile

export type Document = {
  id: string
  name: string
  status: "New" | "Processing" | "Processed" | "Error"
  uploadStatus: "Uploading" | "Uploaded"
  size: string
  file: File
  content?: string
  triples?: Triple[]
  graph?: {
    nodes: Array<{ id: string; label: string }>
    edges: Array<{ source: string; target: string; label: string }>
  }
  error?: string
  chunkCount?: number
  extractedDate?: Date
  processingMethod?: 'default' | 'langchain' | 'graphtransformer' | 'fallback'
  embeddings?: {
    count: number
    generated: Date
    status: "New" | "Processing" | "Processed" | "Error"
    error?: string
  }
  convertedFromPdf?: boolean
  originalPdfName?: string
  /** Learn-service document id (content namespace) — keys reader/markdown lookups. */
  learnDocId?: string
  /** When undefined, all TOC sections are selected for extraction. */
  selectedSectionKeys?: string[]
}

export type ProcessingProgress = {
  docIndex: number
  docTotal: number
  docName: string
  sectionTitle?: string
  completedChunks: number
  totalChunks: number
  percent: number
  etaSeconds: number | null
  phase: 'preparing' | 'extracting' | 'storing' | 'done'
}

export type LLMProvider = 'nvidia' | 'ollama';

export type ProcessingOptions = {
  useLangChain?: boolean;
  useGraphTransformer?: boolean;
  promptConfigs?: PromptConfigurations;
  llmProvider?: LLMProvider;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
  chunkSize?: number;
  overlapSize?: number;
  chunkingMethod?: 'optimized' | 'pyg';
  selectedSectionKeys?: string[];
};

type DocumentContextType = {
  documents: Document[]
  addDocuments: (items: DocumentAddInput[]) => void
  deleteDocuments: (documentIds: string[]) => void
  clearDocuments: () => void
  processDocuments: (selectedDocIds?: string[], options?: ProcessingOptions) => Promise<void>
  // Legacy method for backward compatibility
  processDocumentsLegacy: (useLangChain: boolean, selectedDocIds?: string[], useGraphTransformer?: boolean, promptConfigs?: PromptConfigurations) => Promise<void>
  isProcessing: boolean
  processingProgress: ProcessingProgress | null
  updateDocumentSectionSelection: (documentId: string, keys: string[] | undefined) => void
  renameDocument: (documentId: string, name: string) => void
  updateTriples: (documentId: string, triples: Triple[]) => void
  addTriple: (documentId: string, triple: Triple) => void
  editTriple: (documentId: string, index: number, triple: Triple) => void
  deleteTriple: (documentId: string, index: number) => void
  generateEmbeddings: (documentId: string) => Promise<void>
  isGeneratingEmbeddings: boolean
  viewTriples?: (documentId: string) => void
}

const DocumentContext = createContext<DocumentContextType | undefined>(undefined)

// Utility function to generate UUID with fallback
const generateUUID = (): string => {
  // Check if crypto.randomUUID is available
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch (error) {
      console.warn('crypto.randomUUID failed, using fallback:', error);
    }
  }
  
  // Fallback UUID generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export function DocumentProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [isInitialized, setIsInitialized] = useState(false)
  // Only enable the destructive autosave once the initial load SUCCEEDS. If the
  // first GET fails (e.g. a transient 401/500), documents stays [] and an autosave
  // would otherwise PUT an empty list and wipe the durable server copy.
  const canPersistRef = useRef(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null)
  const [isGeneratingEmbeddings, setIsGeneratingEmbeddings] = useState(false)
  const [apiKey, setApiKey] = useState<string | null>(null)

  // Load API key from localStorage on client-side only
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // API key loading removed - xAI integration has been removed
    }
  }, []);

  // Reconstruct File objects from serialized documents (server or localStorage)
  const reviveDocuments = (parsed: any[]): Document[] =>
    parsed.map((doc: any) => {
      let file: File
      if (doc.content) {
        const blob = new Blob([doc.content], { type: 'text/plain' })
        file = new File([blob], doc.name, { type: 'text/plain' })
      } else {
        file = new File([], doc.name, { type: 'text/plain' })
      }
      // Processing state lives in the tab that ran it; a persisted "Processing"
      // status means the run was interrupted (reload/crash) and would otherwise
      // spin forever and block re-processing.
      if (doc.status === 'Processing') {
        return {
          ...doc,
          file,
          status: 'Error',
          error: 'Processing was interrupted — run Process again.',
        }
      }
      return { ...doc, file }
    })

  // Serialize for server storage. Keep records SMALL and safe:
  //  - File isn't serializable -> store just its metadata (guard a missing file).
  //  - triples/graph are regenerable (they live in the graph DB) and can be huge;
  //    dropping them keeps the saved record from exceeding limits and failing the
  //    whole save.
  //  - very large content (a converted book's markdown) is dropped; the durable
  //    copy lives server-side under learnDocId and is fetched on demand.
  const serializeDocuments = (docs: Document[]) =>
    docs.map((doc) => {
      const shouldSaveContent = !doc.content || doc.content.length < 100000
      const { triples, graph, ...rest } = doc as Document & {
        triples?: unknown
        graph?: unknown
      }
      return {
        ...rest,
        file: doc.file
          ? { name: doc.file.name, size: doc.file.size, type: doc.file.type }
          : { name: doc.name, size: 0, type: "text/plain" },
        content: shouldSaveContent ? doc.content : undefined,
      }
    })

  // Load documents from the server; one-time import from the legacy
  // localStorage store when the server list is still empty.
  useEffect(() => {
    if (isInitialized) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch('/api/documents')
        if (!res.ok) throw new Error(`GET /api/documents -> ${res.status}`)
        const data = await res.json()
        const serverDocs = Array.isArray(data.documents) ? data.documents : []
        // Load succeeded — safe to let the autosave persist from here on.
        canPersistRef.current = true

        if (serverDocs.length > 0) {
          if (!cancelled) setDocuments(reviveDocuments(serverDocs))
        } else {
          const saved = localStorage.getItem('txt2kg_documents')
          if (saved) {
            const parsed = JSON.parse(saved)
            if (Array.isArray(parsed) && parsed.length > 0 && !cancelled) {
              console.log(`Importing ${parsed.length} documents from localStorage`)
              setDocuments(reviveDocuments(parsed))
            }
            // Remove so another account on this browser can't re-import them.
            localStorage.removeItem('txt2kg_documents')
          }
        }
      } catch (error) {
        console.error('Error loading documents from server:', error)
      } finally {
        if (!cancelled) setIsInitialized(true)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [isInitialized])

  // Persist documents to the server (debounced), but only after a SUCCESSFUL
  // load — never autosave (and risk wiping) on top of a failed initial fetch.
  useEffect(() => {
    if (!isInitialized || !canPersistRef.current) return
    const timer = setTimeout(() => {
      fetch('/api/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: serializeDocuments(documents) }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`PUT /api/documents -> ${res.status}`)
        })
        .catch((error) => console.error('Error saving documents to server:', error))
    }, 800)
    return () => clearTimeout(timer)
  }, [documents, isInitialized])

  const addDocuments = (items: DocumentAddInput[]) => {
    const newDocuments = items.map((item) => {
      const prepared: PreparedIngestFile =
        item instanceof File ? { file: item } : item
      const { file, convertedFromPdf, originalPdfName, learnDocId } = prepared
      return {
        id: generateUUID(),
        name: file.name,
        status: "New" as const,
        uploadStatus: "Uploaded" as const,
        size: (file.size / 1024).toFixed(2),
        file,
        ...(convertedFromPdf ? { convertedFromPdf: true as const } : {}),
        ...(originalPdfName ? { originalPdfName } : {}),
        ...(learnDocId ? { learnDocId } : {}),
      }
    })

    setDocuments((prev) => [...prev, ...newDocuments])
  }

  const deleteDocuments = (documentIds: string[]) => {
    setDocuments((prev) => prev.filter((doc) => !documentIds.includes(doc.id)))
  }

  const clearDocuments = () => {
    setDocuments([])
    // Explicit clear — the route ignores empty PUTs by default (wipe guard), so
    // signal intent with ?clear=1.
    fetch('/api/documents?clear=1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: [] }),
    }).catch((error) => console.error('Error clearing documents:', error))
  }

  const updateDocumentStatus = (id: string, status: Document["status"], updates: Partial<Document> = {}) => {
    console.log(`Updating document ${id} status to: ${status}`);
    setDocuments((prev) => {
      const updated = prev.map((doc) => (doc.id === id ? { ...doc, status, ...updates } : doc));
      
      // Force UI refresh by adding timestamp to document state
      // This ensures React detects the change and re-renders components
      const timestamped = updated.map(doc => ({
        ...doc,
        _lastUpdated: Date.now() // Adding timestamp helps React detect changes
      }));
      
      return timestamped;
    });
    
    // Trigger a custom event for components that need to refresh
    if (typeof window !== 'undefined') {
      console.log('Dispatching document-status-changed event');
      window.dispatchEvent(new CustomEvent('document-status-changed', { 
        detail: { documentId: id, status }
      }));
    }
  }

  const updateDocumentSectionSelection = (documentId: string, keys: string[] | undefined) => {
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === documentId ? { ...doc, selectedSectionKeys: keys } : doc,
      ),
    )
  }

  const renameDocument = (documentId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === documentId ? { ...doc, name: trimmed } : doc)),
    )
  }

  const updateTriples = (documentId: string, triples: Triple[]) => {
    const normalizeText = (text: string | null | undefined): string => {
      if (text == null || typeof text !== "string") return "";
      return text.replace(/['"()]/g, "").trim();
    };

    // Normalize triples before saving
    const normalizedTriples = triples.map(triple => ({
      subject: normalizeText(triple.subject),
      predicate: normalizeText(triple.predicate),
      object: normalizeText(triple.object)
    }));

    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id === documentId) {
          const graph = triplesToGraph(normalizedTriples)
          return { ...doc, triples: normalizedTriples, graph }
        }
        return doc
      }),
    )
  }

  const addTriple = (documentId: string, triple: Triple) => {
    // Helper function to normalize text with null/undefined checks
    const normalizeText = (text: string | null | undefined): string => {
      if (!text || typeof text !== 'string') return '';
      return text.replace(/['"()]/g, '').trim();
    };

    // Normalize the new triple
    const normalizedTriple = {
      subject: normalizeText(triple.subject),
      predicate: normalizeText(triple.predicate),
      object: normalizeText(triple.object)
    };

    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id === documentId && doc.triples) {
          const newTriples = [...doc.triples, normalizedTriple]
          const graph = triplesToGraph(newTriples)
          return { ...doc, triples: newTriples, graph }
        }
        return doc
      }),
    )
  }

  const editTriple = (documentId: string, index: number, triple: Triple) => {
    // Helper function to normalize text with null/undefined checks
    const normalizeText = (text: string | null | undefined): string => {
      if (!text || typeof text !== 'string') return '';
      return text.replace(/['"()]/g, '').trim();
    };

    // Normalize the edited triple
    const normalizedTriple = {
      subject: normalizeText(triple.subject),
      predicate: normalizeText(triple.predicate),
      object: normalizeText(triple.object)
    };

    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id === documentId && doc.triples) {
          const newTriples = [...doc.triples]
          newTriples[index] = normalizedTriple
          const graph = triplesToGraph(newTriples)
          return { ...doc, triples: newTriples, graph }
        }
        return doc
      }),
    )
  }

  const deleteTriple = (documentId: string, index: number) => {
    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id === documentId && doc.triples) {
          const newTriples = doc.triples.filter((_, i) => i !== index)
          const graph = triplesToGraph(newTriples)
          return { ...doc, triples: newTriples, graph }
        }
        return doc
      }),
    )
  }

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Check if it's a valid file with size
      if (file.size === 0) {
        // Handle zero-byte files
        console.warn(`File ${file.name} is empty (0 bytes)`);
        reject(new Error('File is empty (0 bytes)'));
        return;
      }
      
      // If the file isn't a real file (like from localStorage), handle that case
      if (!(file instanceof Blob) || (file.size === 0 && file.type === '')) {
        console.warn(`File ${file.name} appears to be a placeholder or invalid`);
        reject(new Error('Invalid file reference - likely a placeholder'));
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (!content || content.trim() === '') {
          console.warn(`File ${file.name} content is empty or whitespace only`);
          reject(new Error('File content is empty'));
          return;
        }
        resolve(content);
      };
      reader.onerror = (e) => {
        console.error(`Error reading file ${file.name}:`, e);
        reject(e);
      };
      reader.readAsText(file);
    });
  }

  const extractTriplesFromChunk = async (chunk: string, systemPrompt?: string): Promise<Triple[]> => {
    console.log(`Extracting triples from chunk of length: ${chunk.length}`)
    
    // Create headers with API key if available
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    
    // Add API key to headers if available
    if (apiKey) {
      headers["X-API-Key"] = apiKey
    }

    // Prepare request body with optional custom system prompt
    const requestBody: any = { text: chunk };
    if (systemPrompt) {
      requestBody.systemPrompt = systemPrompt;
    }

    // Add LLM provider information based on selected model
    const selectedModel = localStorage.getItem("selectedModel");
    if (selectedModel) {
      try {
        const model = JSON.parse(selectedModel);
        if (model.provider === "ollama") {
          requestBody.llmProvider = "ollama";
          requestBody.ollamaModel = model.model || "llama3.1:8b";
          console.log(`🦙 Using Ollama model: ${requestBody.ollamaModel}`);
        } else if (model.provider === "vllm") {
          requestBody.llmProvider = "vllm";
          requestBody.vllmModel = model.model;
          requestBody.vllmBaseUrl = model.baseURL || "http://localhost:8001/v1";
          console.log(`🚀 Using vLLM model: ${requestBody.vllmModel}`);
        } else if (model.id === "nvidia-nemotron" || model.id === "nvidia-nemotron-nano") {
          requestBody.llmProvider = "nvidia";
          requestBody.nvidiaModel = model.model; // Pass the actual model name
          console.log(`🖥️ Using NVIDIA model: ${model.model}`);
        }
      } catch (e) {
        // Ignore parsing errors, will use default
        console.log(`⚠️ Error parsing selected model, using default`);
      }
    } else {
      console.log(`⚠️ No selected model found, using default`);
    }

    const response = await fetch("/api/extract-triples", {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      // Rely on server-side timeout configuration instead of client-side AbortSignal
    })

    console.log("API response status:", response.status)

    const bodyText = await response.text()
    let data: { error?: string; triples?: Triple[] }
    try {
      data = JSON.parse(bodyText) as { error?: string; triples?: Triple[] }
    } catch {
      throw new Error(
        response.ok
          ? "Invalid JSON from extract-triples API"
          : `Extract triples failed (${response.status}): ${bodyText.slice(0, 240)}`,
      )
    }

    if (!response.ok) {
      console.error("API error:", data)
      throw new Error(data.error || "Failed to extract triples")
    }

    console.log("API response data:", data)
    console.log("Triples count:", data.triples?.length || 0)

    return data.triples || []
  }

  // New processDocuments method with better options structure
  const processDocuments = async (
    selectedDocIds?: string[], 
    options?: ProcessingOptions
  ) => {
    console.log('🔍 processDocuments called with:', {
      selectedDocIds,
      selectedCount: selectedDocIds?.length || 0,
      options
    });
    
    const {
      useLangChain = false,
      useGraphTransformer = false,
      promptConfigs,
      llmProvider = 'ollama',
      ollamaModel = 'qwen3:1.7b',
      ollamaBaseUrl = 'http://localhost:11434/v1',
      chunkSize = 64000,
      overlapSize = 2000,
      chunkingMethod = 'optimized',
      selectedSectionKeys,
    } = options || {};

    return processDocumentsImpl(useLangChain, selectedDocIds, useGraphTransformer, promptConfigs, {
      llmProvider,
      ollamaModel,
      ollamaBaseUrl,
      chunkSize,
      overlapSize,
      chunkingMethod,
      selectedSectionKeys,
    });
  };

  // Legacy method for backward compatibility
  const processDocumentsLegacy = async (
    useLangChain: boolean, 
    selectedDocIds?: string[], 
    useGraphTransformer?: boolean,
    promptConfigs?: PromptConfigurations
  ) => {
    return processDocumentsImpl(useLangChain, selectedDocIds, useGraphTransformer, promptConfigs);
  };

  const processDocumentsImpl = async (
    useLangChain: boolean, 
    selectedDocIds?: string[], 
    useGraphTransformer?: boolean,
    promptConfigs?: PromptConfigurations,
    llmOptions?: {
      llmProvider?: LLMProvider;
      ollamaModel?: string;
      ollamaBaseUrl?: string;
      chunkSize?: number;
      overlapSize?: number;
      chunkingMethod?: 'optimized' | 'pyg';
      selectedSectionKeys?: string[];
    }
  ) => {
    console.log('🔍 processDocumentsImpl called with:', {
      useLangChain,
      selectedDocIds,
      selectedCount: selectedDocIds?.length || 0,
      useGraphTransformer,
      totalDocuments: documents.length
    });
    
    // If selectedDocIds is explicitly provided, use it
    // If not provided, don't process anything (instead of processing all docs)
    const docIdsToProcess = selectedDocIds || [];
    
    console.log('🔍 Document IDs to process:', docIdsToProcess);
    
    // Get selected documents - filter by the provided selectedDocIds array
    const docsToProcess = documents.filter(
      (doc) => docIdsToProcess.includes(doc.id) && 
      (doc.status === "New" || doc.status === "Processed" || doc.status === "Error")
    );

    console.log('🔍 Documents to process:', docsToProcess.map(d => ({ id: d.id, name: d.name, status: d.status })));

    if (docsToProcess.length === 0) {
      console.log("❌ No documents to process - either none selected or none have valid status");
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(null);

    const docTotal = docsToProcess.length;
    let docIndex = 0;

    const reportProgress = (
      docName: string,
      phase: ProcessingProgress['phase'],
      event?: { completedChunks: number; totalChunks: number; sectionTitle?: string },
      extractStartTime?: number,
    ) => {
      const completedChunks = event?.completedChunks ?? 0;
      const totalChunks = event?.totalChunks ?? 0;
      const percent =
        totalChunks > 0 ? Math.min(100, Math.round((100 * completedChunks) / totalChunks)) : 0;
      let etaSeconds: number | null = null;
      if (
        extractStartTime &&
        completedChunks > 0 &&
        totalChunks > completedChunks
      ) {
        const elapsed = (Date.now() - extractStartTime) / 1000;
        etaSeconds = Math.round((elapsed / completedChunks) * (totalChunks - completedChunks));
      }
      setProcessingProgress({
        docIndex,
        docTotal,
        docName,
        sectionTitle: event?.sectionTitle,
        completedChunks,
        totalChunks,
        percent,
        etaSeconds,
        phase,
      });
    };

    // Persist extracted triples into the graph DB (ArangoDB). Extraction
    // (/api/process-document) no longer writes to the DB, so without this the
    // entities/relationships collections stay empty after "processing".
    const persistTriplesToGraphDb = async (triplesToStore: Triple[], documentName: string, documentId?: string) => {
      if (!triplesToStore || triplesToStore.length === 0) return;
      try {
        const storeResp = await fetch('/api/graph-db/triples', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triples: triplesToStore, documentName, documentId }),
        });
        if (!storeResp.ok) {
          const errText = await storeResp.text();
          console.error(`Graph DB storage failed for ${documentName}: ${storeResp.status} ${storeResp.statusText}`, errText);
          return;
        }
        console.log(`Stored ${triplesToStore.length} triples for ${documentName} in graph DB`);
      } catch (storeErr) {
        console.error(`Error storing triples for ${documentName} in graph DB:`, storeErr);
      }
    };

    try {
      // Check which documents are already processed in ArangoDB
      console.log('🔍 Checking which documents are already processed in ArangoDB...');
      let alreadyProcessedDocs: Set<string> = new Set();
      
      try {
        const response = await fetch('/api/graph-db/check-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentNames: docsToProcess.map(d => d.name)
          })
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.processedDocuments) {
            Object.entries(result.processedDocuments).forEach(([docName, isProcessed]) => {
              if (isProcessed) {
                alreadyProcessedDocs.add(docName);
              }
            });
            console.log(`✅ Found ${alreadyProcessedDocs.size} documents already processed in ArangoDB:`, Array.from(alreadyProcessedDocs));
          }
        }
      } catch (checkError) {
        console.warn('⚠️ Could not check for already processed documents, continuing anyway:', checkError);
      }

      // Process each document sequentially
      for (let docLoopIndex = 0; docLoopIndex < docsToProcess.length; docLoopIndex++) {
        const doc = docsToProcess[docLoopIndex];
        docIndex = docLoopIndex + 1;
        // Skip if document is already processed in ArangoDB
        if (alreadyProcessedDocs.has(doc.name)) {
          console.log(`⏭️ Skipping document "${doc.name}" - already processed in ArangoDB`);
          updateDocumentStatus(doc.id, "Processed", {
            triples: doc.triples || [],
            graph: doc.graph,
            error: undefined
          });
          toast({
            title: "Document Skipped",
            description: `"${doc.name}" is already stored in ArangoDB`,
            duration: 3000,
          });
          continue;
        }
        // Update status to Processing before we begin
        updateDocumentStatus(doc.id, "Processing");
        reportProgress(doc.name, 'preparing');
        
        try {
          // Read file content if not already available. Learn-backed docs (a PDF converted
          // into server-side sections) re-extract entirely from `learnDocId` and never need
          // the original file — and their large markdown `content` is intentionally dropped on
          // persist, so the revived File is a 0-byte placeholder. Don't let that empty placeholder
          // block re-processing; only the legacy/CSV client paths actually require the file.
          let content = doc.content;
          if (!content) {
            try {
              content = await readFileContent(doc.file);
            } catch (err) {
              if (!doc.learnDocId) throw err;
              // learn path: proceed without the original file (server-side sections drive it)
            }
          }

          console.log(`🚀 Processing document ${doc.name}, useLangChain: ${useLangChain}, isCSV: ${doc.name.toLowerCase().endsWith('.csv')}`);
          
          // Handle CSV files specially - always use row-as-document processing regardless of LangChain setting
          if (doc.name.toLowerCase().endsWith('.csv')) {
            console.log('📊 Processing CSV file with row-as-document approach:', doc.name);
            
            try {
              const triples = await parseCSVContent(content);
              console.log(`✅ CSV processing complete: ${triples.length} triples extracted`);
              
              // Send to process-document API
              const response = await fetch('/api/process-document', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  text: content,
                  filename: doc.name,
                  triples: triples,
                  useLangChain: useLangChain, // Pass through the original setting
                  useGraphTransformer: useGraphTransformer,
                  systemPrompt: promptConfigs?.systemPrompt,
                  extractionPrompt: promptConfigs?.extractionPrompt,
                  graphTransformerPrompt: promptConfigs?.graphTransformerPrompt
                })
              });
              
              if (!response.ok) {
                throw new Error(`Document processing failed: ${response.statusText}`);
              }
              
              const result = await response.json();
              
              // Update the document with triples and graph
              updateDocumentStatus(doc.id, "Processed", {
                triples: triples,
                graph: triplesToGraph(triples),
                metadata: {
                  totalTriples: triples.length,
                  processingMethod: 'csv_row_as_document',
                  langchainUsed: useLangChain,
                  graphTransformerUsed: useGraphTransformer
                }
              });
              
              console.log(`✅ Document ${doc.name} processed successfully with ${triples.length} triples`);
            } catch (error) {
              console.error(`❌ Error processing CSV file ${doc.name}:`, error);
              updateDocumentStatus(doc.id, "Error", {
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
            
            continue; // Skip the rest of the processing for CSV files
          }
          
          // Concept extraction is the primary processing path now (logic-triple extraction
          // is paused). It runs server-side on the learn service's stored sections — which
          // are populated when a PDF is converted — and honors the TOC-preview selection.
          // (`useLangChain`/`useGraphTransformer` and the client triple path no longer apply.)
          if (!doc.learnDocId) {
            // Non-PDF uploads (.md/.txt/.json) have no server-side sections to build a course
            // from. Surface that clearly instead of silently doing nothing.
            updateDocumentStatus(doc.id, "Error", {
              content,
              error:
                "Concept extraction needs a PDF converted through the learn pipeline; this " +
                "document has no server-side sections. Upload it as a PDF to build a course.",
            });
            continue;
          }

          {
            const learnDocId = doc.learnDocId;
            // undefined selection = whole document; otherwise just the chosen TOC sections.
            const sectionKeys =
              llmOptions?.selectedSectionKeys !== undefined
                ? llmOptions.selectedSectionKeys
                : doc.selectedSectionKeys;

            const extractStartTime = Date.now();
            reportProgress(doc.name, 'extracting');
            const started = await startExtraction(null, learnDocId, sectionKeys);
            if (started.status === 'error') {
              throw new Error(started.error || 'Failed to start concept extraction');
            }

            // Poll the background job to completion. Concept extraction is GPU-bound (minutes
            // per chapter); the learn service keeps running even if the user navigates away.
            // Each poll feeds the job's per-section progress into the GUI progress bar.
            const summary = await new Promise<NonNullable<ExtractStatusResponse['summary']>>(
              (resolve, reject) => {
                const poll = async () => {
                  try {
                    const st = await getExtractionStatus(null, learnDocId);
                    if (st.status === 'done') return resolve(st.summary ?? {});
                    if (st.status === 'error') {
                      return reject(new Error(st.error || 'Concept extraction failed'));
                    }
                    if (st.status === 'idle') {
                      return reject(
                        new Error(
                          'Concept extraction was lost (the learn service may have restarted) — please retry.',
                        ),
                      );
                    }
                    // running — advance the progress bar from sections completed.
                    const p = st.progress;
                    if (p && p.total > 0) {
                      reportProgress(
                        doc.name,
                        'extracting',
                        { completedChunks: p.done, totalChunks: p.total, sectionTitle: p.current ?? undefined },
                        extractStartTime,
                      );
                    }
                  } catch {
                    /* transient poll failure — keep polling */
                  }
                  window.setTimeout(poll, 4000);
                };
                window.setTimeout(poll, 1500);
              },
            );

            console.log(
              `Concept extraction done for ${doc.name}: ${summary.concepts ?? 0} concepts across ${summary.extracted ?? 0} sections`,
            );
            updateDocumentStatus(doc.id, "Processed", {
              content,
              extractedDate: new Date(),
              processingMethod: 'concepts',
              metadata: {
                concepts: summary.concepts ?? 0,
                sections: summary.extracted ?? summary.sections ?? 0,
                questions: summary.questions ?? 0,
                prereqEdges: summary.prereqEdges ?? 0,
              },
            });
          }
        } catch (error) {
          console.error(`Error processing document ${doc.name}:`, error);
          updateDocumentStatus(doc.id, "Error", {
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    } finally {
      // Add a small delay before turning off the processing state
      // This gives time for all UI updates to complete
      console.log("Processing complete, finalizing UI updates...");
      
      // Force a final UI refresh by dispatching an event immediately
      if (typeof window !== 'undefined') {
        console.log("Dispatching processing-complete event");
        window.dispatchEvent(new CustomEvent('processing-complete'));
      }
      
      // Reset the processing state
      setIsProcessing(false);
      setProcessingProgress(null);
      console.log("Processing state reset, UI should be updated");
    }
  }

  // Helper function to process CSV content - each row as a document for LLM extraction
  const parseCSVContent = async (csvContent: string): Promise<Triple[]> => {
    console.log('🔍 parseCSVContent called with content length:', csvContent.length);
    console.log('Processing CSV content with row-as-document approach');
    
    // Split the CSV content into lines
    const lines = csvContent.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length < 2) {
      throw new Error("CSV file must contain a header row and at least one data row");
    }
    
    // Parse the header row
    const header = lines[0].split(',').map(h => h.trim().replace(/^"(.*)"$/, '$1'));
    console.log(`CSV headers: ${header.join(', ')}`);
    
    // Get data rows (skip header)
    const dataRows = lines.slice(1);
    console.log(`Processing ${dataRows.length} data rows as individual documents`);
    
    let allTriples: Triple[] = [];
    const BATCH_SIZE = 50; // Store every 50 rows
    let currentBatch: Triple[] = [];
    let storedTriples = 0;
    
    // Process each row as a separate document
    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const line = dataRows[rowIdx];
      
      try {
        // Parse CSV row into fields
        const fields: string[] = [];
        let fieldStart = 0;
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') {
            inQuotes = !inQuotes;
          } else if (line[i] === ',' && !inQuotes) {
            fields.push(line.substring(fieldStart, i).trim().replace(/^"(.*)"$/, '$1'));
            fieldStart = i + 1;
          }
        }
        
        // Add the last field
        fields.push(line.substring(fieldStart).trim().replace(/^"(.*)"$/, '$1'));
        
        // Create document text from the row data
        let documentText = '';
        for (let i = 0; i < Math.min(header.length, fields.length); i++) {
          if (fields[i] && fields[i].trim()) {
            documentText += `${header[i]}: ${fields[i]}\n`;
          }
        }
        
        // Skip empty rows
        if (!documentText.trim()) {
          console.warn(`Skipping empty CSV row ${rowIdx + 1}`);
          continue;
        }
        
        console.log(`Processing row ${rowIdx + 1} as document: ${documentText.substring(0, 100)}...`);
        
        // Extract triples from this row's text using the existing extraction function
        try {
          console.log(`🔄 Calling extractTriplesFromChunk for row ${rowIdx + 1}`);
          // Note: promptConfigs is not available in this scope, so we'll pass undefined for now
          const rowTriples = await extractTriplesFromChunk(documentText, undefined);
          
          console.log(`📥 extractTriplesFromChunk returned:`, rowTriples);
          
          if (rowTriples && Array.isArray(rowTriples)) {
            console.log(`✅ Extracted ${rowTriples.length} triples from row ${rowIdx + 1}`);
            allTriples = allTriples.concat(rowTriples);
            currentBatch = currentBatch.concat(rowTriples);
            
            // Store batch every BATCH_SIZE rows or on last row
            if (currentBatch.length >= BATCH_SIZE || rowIdx === dataRows.length - 1) {
              try {
                console.log(`💾 Storing batch: ${currentBatch.length} triples (rows ${storedTriples + 1}-${rowIdx + 1})`);
                
                // Store batch to database via API
                const batchResponse = await fetch('/api/graph-db/triples', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    triples: currentBatch,
                    source: `CSV batch ${Math.floor(storedTriples / BATCH_SIZE) + 1}`
                  })
                });
                
                if (batchResponse.ok) {
                  storedTriples += currentBatch.length;
                  console.log(`✅ Batch stored successfully! Progress: ${storedTriples} total triples stored`);
                } else {
                  console.error(`❌ Failed to store batch: ${batchResponse.statusText}`);
                  // Continue processing even if storage fails
                }
                
                currentBatch = []; // Reset batch
              } catch (batchError) {
                console.error(`❌ Error storing batch at row ${rowIdx + 1}:`, batchError);
                // Continue processing even if one batch fails
              }
            }
          } else {
            console.warn(`⚠️ No valid triples returned for row ${rowIdx + 1}`);
          }
        } catch (error) {
          console.error(`❌ Error extracting triples from row ${rowIdx + 1}:`, error);
          continue;
        }
        
      } catch (parseError) {
        console.error(`Error parsing CSV row ${rowIdx + 1}:`, parseError);
        continue;
      }
    }
    
    console.log(`🏁 Successfully extracted ${allTriples.length} triples from ${dataRows.length} CSV rows`);
    console.log('Final triples array:', allTriples);
    return allTriples;
  }

  // Helper function to convert JSON content to readable text format
  const convertJsonToText = (jsonContent: string): string => {
    try {
      // Parse the JSON to validate it
      const jsonData = JSON.parse(jsonContent);
      
      // Convert JSON to a readable text format that preserves structure and relationships
      const formatJsonObject = (obj: any, indent: number = 0): string => {
        const spaces = '  '.repeat(indent);
        
        if (obj === null || obj === undefined) {
          return 'null';
        }
        
        if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
          return String(obj);
        }
        
        if (Array.isArray(obj)) {
          if (obj.length === 0) return '[]';
          const items = obj.map((item, index) => 
            `${spaces}  Item ${index + 1}: ${formatJsonObject(item, indent + 1)}`
          ).join('\n');
          return `[\n${items}\n${spaces}]`;
        }
        
        if (typeof obj === 'object') {
          const entries = Object.entries(obj);
          if (entries.length === 0) return '{}';
          
          const props = entries.map(([key, value]) => 
            `${spaces}  ${key}: ${formatJsonObject(value, indent + 1)}`
          ).join('\n');
          return `{\n${props}\n${spaces}}`;
        }
        
        return String(obj);
      };
      
      // Create a descriptive text representation
      let textContent = `JSON Document Content:\n\n`;
      textContent += formatJsonObject(jsonData);
      
      return textContent;
    } catch (error) {
      console.warn('Failed to parse JSON, treating as plain text:', error);
      // If JSON parsing fails, return the original content as-is
      return jsonContent;
    }
  }

  const generateEmbeddings = async (documentId: string) => {
    // Add more detailed diagnostics
    const doc = documents.find(d => d.id === documentId);
    
    if (!doc) {
      toast({
        title: "Document Not Found",
        description: `Could not find document with ID: ${documentId}`,
        variant: "destructive",
        duration: 3000,
      });
      return;
    }
    
    // If content already exists, use it right away
    if (doc.content && doc.content.trim() !== '') {
      await processEmbeddings(doc.id, doc.name, doc.content);
      return;
    }
    
    // Document exists but content is not loaded - log debug info
    console.log(`Attempting to load content for document: ${doc.name}`);
    console.log(`File info: size=${doc.file.size}, type=${doc.file.type}`);
    
    // Check if the document was loaded from localStorage and might have a corrupted file reference
    const isLikelyFromLocalStorage = doc.file.size === 0 || !(doc.file instanceof Blob);
    
    if (isLikelyFromLocalStorage) {
      toast({
        title: "File Reference Issue",
        description: "This document was restored from browser storage and cannot access its original file. Please re-upload the file or process it again first.",
        variant: "destructive",
        duration: 5000,
      });
      return;
    }
    
    try {
      // Document exists but content might not be loaded - try to load it
      const content = await readFileContent(doc.file);
      if (content && content.trim() !== '') {
        // Update the document with content first
        setDocuments(prevDocs => 
          prevDocs.map(d => {
            if (d.id === documentId) {
              return {
                ...d,
                content: content
              };
            }
            return d;
          })
        );
        
        // Continue with the loaded content
        await processEmbeddings(doc.id, doc.name, content);
      } else {
        toast({
          title: "Empty Document",
          description: "The document file appears to be empty",
          variant: "destructive",
          duration: 3000,
        });
      }
    } catch (error) {
      toast({
        title: "Content Loading Error",
        description: `Failed to load document content: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  // Helper function to handle the actual embeddings processing
  const processEmbeddings = async (documentId: string, documentName: string, content: string) => {
    setIsGeneratingEmbeddings(true);
    try {
      console.log(`Generating embeddings for document: ${documentName}`);
      
      // Update embeddings status to show it's processing, without changing main document status
      setDocuments(prevDocs => 
        prevDocs.map(d => {
          if (d.id === documentId) {
            return {
              ...d,
              embeddings: {
                count: d.embeddings?.count || 0,
                generated: d.embeddings?.generated || new Date(),
                status: "Processing" as const
              }
            };
          }
          return d;
        })
      );
      
      const response = await fetch('/api/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          documentId: documentId,
          content: content,
          documentName: documentName
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to generate embeddings: ${await response.text()}`);
      }
      
      const result = await response.json();
      console.log('Embeddings generation result:', result);
      
      // Update embeddings status to show it's processed
      setDocuments(prevDocs => 
        prevDocs.map(d => {
          if (d.id === documentId) {
            return {
              ...d,
              embeddings: {
                count: result.embeddings,
                generated: new Date(),
                status: "Processed" as const
              }
            };
          }
          return d;
        })
      );
      
      // Show a toast notification
      toast({
        title: "Embeddings Generated",
        description: `Successfully generated ${result.embeddings} embeddings for "${documentName}"`,
        duration: 5000,
      });
      
    } catch (error) {
      console.error('Error generating embeddings:', error);
      
      // Update embeddings status to show there was an error
      setDocuments(prevDocs => 
        prevDocs.map(d => {
          if (d.id === documentId) {
            return {
              ...d,
              embeddings: {
                count: d.embeddings?.count || 0,
                generated: d.embeddings?.generated || new Date(),
                status: "Error" as const,
                error: error instanceof Error ? error.message : String(error)
              }
            };
          }
          return d;
        })
      );
      
      toast({
        title: "Embeddings Generation Failed",
        description: `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsGeneratingEmbeddings(false);
    }
  };

  return (
    <DocumentContext.Provider
      value={{
        documents,
        addDocuments,
        deleteDocuments,
        clearDocuments,
        processDocuments,
        processDocumentsLegacy,
        isProcessing,
        processingProgress,
        updateDocumentSectionSelection,
        renameDocument,
        updateTriples,
        addTriple,
        editTriple,
        deleteTriple,
        generateEmbeddings,
        isGeneratingEmbeddings
      }}
    >
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocuments() {
  const context = useContext(DocumentContext)
  if (context === undefined) {
    throw new Error("useDocuments must be used within a DocumentProvider")
  }
  return context
}