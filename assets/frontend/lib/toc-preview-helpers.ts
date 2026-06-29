//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//

import type { TocAnalysisResult, TocBlock } from '@/utils/toc-processing';
import { resolveDocumentOutline } from '@/utils/toc-processing';

export const LLM_TOC_FALLBACK_STORAGE_KEY = 'txt2kg_llm_toc_fallback';

export function isLlmTocFallbackEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(LLM_TOC_FALLBACK_STORAGE_KEY) === 'true';
}

export function setLlmTocFallbackEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LLM_TOC_FALLBACK_STORAGE_KEY, enabled ? 'true' : 'false');
}

export async function inferTocViaApi(text: string, model?: string): Promise<TocAnalysisResult> {
  const res = await fetch('/api/infer-toc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model }),
  });
  const data = (await res.json()) as TocAnalysisResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `TOC inference failed (${res.status})`);
  }
  return data;
}

/** Resolve outline for extraction: heuristics first, optional LLM fallback. */
export async function resolveTocForExtraction(text: string): Promise<TocBlock | null> {
  const heuristic = resolveDocumentOutline(text);
  if (heuristic) return heuristic;

  if (!isLlmTocFallbackEnabled()) return null;

  const analysis = await inferTocViaApi(text);
  if (!analysis.entries?.length) return null;
  return {
    entries: analysis.entries,
    bodyCharStart: analysis.bodyStartsAtChar ?? 0,
  };
}

export function tocSourceLabel(source: TocAnalysisResult['source']): string {
  switch (source) {
    case 'pdf_outline':
      return 'PDF outline';
    case 'toc_block':
      return 'TOC block';
    case 'contents_section':
      return 'Contents section';
    case 'heading_outline':
      return 'Numbered headings';
    case 'heading_levels':
      return 'Heading levels';
    case 'llm_inferred':
      return 'LLM inferred';
    default:
      return 'None detected';
  }
}

export function tocSourceDescription(source: TocAnalysisResult['source']): string {
  switch (source) {
    case 'pdf_outline':
      return "The PDF's own embedded outline / bookmarks — the document's real table of contents.";
    case 'toc_block':
      return 'A leading outline or table was parsed as the document TOC.';
    case 'contents_section':
      return 'A textbook Contents section was parsed (dot leaders and section numbers).';
    case 'heading_outline':
      return 'Section numbers were inferred from markdown headings in the file.';
    case 'heading_levels':
      return 'Section hierarchy was inferred from markdown heading depth (#, ##, ###).';
    case 'llm_inferred':
      return 'Section outline was inferred by the LLM; review before processing.';
    default:
      return 'No outline matched the built-in TOC rules; extraction will use plain chunking.';
  }
}
