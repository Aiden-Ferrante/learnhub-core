//
// SPDX-FileCopyrightText: Copyright (c) 1993-2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//

import {
  buildTocAnalysisResult,
  cleanHeadingMarkup,
  makeSectionKey,
  slugKey,
  type TocAnalysisResult,
  type TocBlock,
  type TocEntry,
} from '@/utils/toc-processing';

const MAX_INPUT_CHARS = 48_000;
/** No practical cap for preview; LLM context is the limiting factor. */
const MAX_SECTIONS = 2000;

export type LlmTocSection = {
  title: string;
  numberKey?: string | null;
  level?: number;
};

function extractAtxHeadingLines(text: string): string[] {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) lines.push(`${'#'.repeat(m[1].length)} ${cleanHeadingMarkup(m[2].trim())}`);
  }
  return lines.slice(0, 400);
}

function buildTocPrompt(text: string): { system: string; user: string } {
  const excerpt = text.slice(0, MAX_INPUT_CHARS);
  const headings = extractAtxHeadingLines(text);
  const headingBlock =
    headings.length > 0
      ? `\n\nMarkdown headings found in document:\n${headings.map((h) => `- ${h}`).join('\n')}`
      : '';

  return {
    system: `You extract a document table of contents as JSON only.
Return a JSON array of objects with fields:
- "title" (string, required): section title without markdown markup
- "numberKey" (string or null): section number like "1.2.3" when present, else null
- "level" (integer 1-6): outline depth (1 = top chapter)

Rules:
- Include major sections and subsections in reading order
- Do not include the document title alone unless it is a real section
- Maximum ${MAX_SECTIONS} entries
- Output ONLY valid JSON array, no markdown fences or commentary`,
    user: `Extract the table of contents / section outline from this document excerpt:${headingBlock}

--- DOCUMENT START ---
${excerpt}
--- DOCUMENT END ---`,
  };
}

function parseJsonArray(raw: string): unknown[] {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  const start = jsonText.indexOf('[');
  const end = jsonText.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response did not contain a JSON array');
  }
  const parsed = JSON.parse(jsonText.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('LLM response JSON is not an array');
  return parsed;
}

function normalizeLlmSections(raw: unknown[]): LlmTocSection[] {
  const out: LlmTocSection[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? cleanHeadingMarkup(rec.title.trim()) : '';
    if (title.length < 2) continue;

    let numberKey: string | null = null;
    if (typeof rec.numberKey === 'string' && rec.numberKey.trim()) {
      numberKey = rec.numberKey.trim();
    } else if (rec.numberKey === null) {
      numberKey = null;
    }

    let level = 1;
    if (typeof rec.level === 'number' && Number.isFinite(rec.level)) {
      level = Math.max(1, Math.min(6, Math.round(rec.level)));
    }

    const dedupeKey = `${numberKey ?? ''}|${title.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ title, numberKey, level });
    if (out.length >= MAX_SECTIONS) break;
  }

  if (out.length < 2) {
    throw new Error('LLM returned fewer than 2 valid sections');
  }
  return out;
}

export function llmSectionsToTocBlock(sections: LlmTocSection[]): TocBlock {
  const minLevel = Math.min(...sections.map((s) => s.level ?? 1));
  const slugStack: string[] = [];
  const entries: TocEntry[] = [];
  const seenKeys = new Set<string>();

  for (const section of sections) {
    const listDepth = Math.max(0, (section.level ?? 1) - minLevel);
    let sectionKey: string;

    if (section.numberKey) {
      sectionKey = makeSectionKey(section.numberKey, section.title, entries.length);
    } else {
      const slug = slugKey(section.title, entries.length);
      while (slugStack.length > listDepth) slugStack.pop();
      slugStack[listDepth] = slug;
      sectionKey = `toc:${slugStack.slice(0, listDepth + 1).join('/')}`;
    }

    if (seenKeys.has(sectionKey)) continue;
    seenKeys.add(sectionKey);
    entries.push({
      numberKey: section.numberKey ?? null,
      title: section.title,
      sectionKey,
      listDepth,
    });
  }

  if (entries.length < 2) {
    throw new Error('Could not map LLM sections to a valid outline');
  }

  return { entries, bodyCharStart: 0 };
}

export function llmSectionsToAnalysis(sections: LlmTocSection[]): TocAnalysisResult {
  const block = llmSectionsToTocBlock(sections);
  return buildTocAnalysisResult('llm_inferred', block);
}

export function parseLlmTocResponse(content: string): TocAnalysisResult {
  const raw = parseJsonArray(content);
  const sections = normalizeLlmSections(raw);
  return llmSectionsToAnalysis(sections);
}

export function buildTocLlmMessages(text: string): { system: string; user: string } {
  return buildTocPrompt(text);
}
