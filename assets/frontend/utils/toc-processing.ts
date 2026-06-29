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
/**
 * TOC-aware extraction: parse an outline at the start of a document, emit
 * deterministic hierarchy triples (has_subsection), align markdown body headings
 * to TOC entries, extract triples per section, and add section_mentions edges
 * from each section node to entities appearing in that section's triples.
 *
 * Supported TOC shapes (prefix of file):
 * - **Headers** (optional): many variants — `# Table of Contents`, `# Contents`, `# TOC`,
 *   `# Outline`, plain `Table of Contents`, `Contents`, `Listing of contents`,
 *   bold `**Table of Contents**`, HTML `<h1>Table of Contents</h1>`, etc.
 * - **Outline rows**: plain `1.2.3 Title`, `Chapter 1: Title`, list `- 1.1 Title`,
 *   blockquote `> 1.1 Title`, indented numbered lines, and **markdown pipe tables**
 *   (`| 1 | | Title | 12 |` or `| | 1.1.1<br>Why … | 1 |`) including `<br>` in cells.
 * - When no TOC prefix exists, **heading outline auto-detection** scans ATX headings
 *   in the body (numbered section titles). Accepts dotted ids (`1.1`, …) or 3+ integer
 *   chapter headings (`## 1 Introduction`).
 * - **Heading-level fallback** builds a hierarchy from ATX `#` depth when 3+ headings
 *   span at least 2 levels (unnumbered native Markdown).
 */

import type { Triple } from '@/types/graph'
import { chunkText, chunkTextPyG, mergeTriples } from '@/utils/text-processing'

/** Predicate for TOC parent → child structure */
export const TOC_SUBSECTION_PREDICATE = 'has_subsection'

/** Predicate linking a TOC section node to an entity string from extracted triples */
export const SECTION_MENTIONS_PREDICATE = 'section_mentions'

const TOC_ROOT_KEY = 'toc:root'

/** Minimum outline lines to treat as a TOC (reduces false positives) */
const MIN_TOC_ENTRIES = 2

/** Do not scan more than this many lines from the start for a TOC block */
const MAX_TOC_SCAN_LINES = 2000

/** Scan up to this many lines after a mid-document Contents heading */
const MAX_CONTENTS_SCAN_LINES = 8000

/** Stop Contents scan after this many consecutive non-TOC lines (once enough entries) */
const CONTENTS_STOP_NON_TOC = 15

/** Minimum entries before Contents scan may stop on consecutive misses */
const MIN_CONTENTS_ENTRIES = 10

/** Minimum numbered entries to accept a Contents section (avoid false positives) */
const MIN_CONTENTS_NUMBERED = 5

/** Minimum headings for heading-level hierarchy detection */
const MIN_HEADING_LEVEL_ENTRIES = 3

/** Without an explicit TOC title, skip up to this many leading lines (e.g. table title row) */
const MAX_TOC_LEADING_SKIP = 28

/** Recognized TOC section title lines (trimmed line, case-insensitive where noted) */
const TOC_HEADER_PATTERNS: RegExp[] = [
  /^\s*#+\s*table\s+of\s+contents\b/i,
  /^\s*#+\s*contents\b/i,
  /^\s*#+\s*toc\b/i,
  /^\s*#+\s*outline\b/i,
  /^\s*#+\s*list\s+of\s+(contents|figures|tables)\b/i,
  /^\s*table\s+of\s+contents\b/i,
  /^\s*contents\b/i,
  /^\s*(the\s+)?listing\s+of\s+contents\b/i,
  /^\s*in\s+this\s+(book|chapter|volume|part)\b/i,
  /^\s*\*{1,2}\s*table\s+of\s+contents\s*\*{1,2}\s*$/i,
  /^\s*\*{1,2}\s*contents\s*\*{1,2}\s*$/i,
  /^\s*<h[1-6][^>]*>\s*table\s+of\s+contents\s*<\/h[1-6]>\s*$/i,
  /^\s*<h[1-6][^>]*>\s*contents\s*<\/h[1-6]>\s*$/i,
]

export type TocEntry = {
  /** Hierarchical number like "1.2.3", or "1" from "Chapter 1", or null if unnumbered */
  numberKey: string | null
  title: string
  /** Stable graph node id, e.g. toc:1.2 */
  sectionKey: string
  /** 0-based markdown list depth when parsed from list items (0 = top) */
  listDepth: number
}

export type TocBlock = {
  entries: TocEntry[]
  /** First character index in the full document where body content begins (after TOC) */
  bodyCharStart: number
}

export function slugKey(title: string, index: number): string {
  const base = typeof title === 'string' ? title : String(title ?? '')
  const s = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return s || `u${index}`
}

export function makeSectionKey(numberKey: string | null, title: string, index: number): string {
  if (numberKey) return `toc:${numberKey}`
  return `toc:${slugKey(title, index)}`
}

/** Strip common PDF/HTML export noise from heading text for parsing and matching */
export function cleanHeadingMarkup(s: string): string {
  const t = typeof s === "string" ? s : String(s ?? "");
  return t
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*/g, "")
    .replace(/_(.+?)_/g, "$1")
    .trim();
}

function normalizeTitle(s: string): string {
  return cleanHeadingMarkup(s)
    .toLowerCase()
    .replace(/\[[^\]]*]/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+(?:\.\d+)*\s*[.:)\-–]\s*/i, '')
    .replace(/^chapter\s+\d+\s*[.:)\-–]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNumberedHeadingBody(cleanedLine: string): { numberKey: string; title: string } | null {
  const m = cleanedLine.match(/^(\d+(?:\.\d+)*)\s*[.:)\-–]?\s+(.+)$/i)
  if (!m) return null
  const title = m[2].trim()
  if (!title) return null
  return { numberKey: m[1], title }
}

function normalizeTableCell(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeMarkdownTableRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.includes('|') && t.length >= 3
}

function isMarkdownTableSeparator(line: string): boolean {
  const t = line.trim()
  if (!t.startsWith('|')) return false
  const core = t.replace(/^\|/, '').replace(/\|\s*$/, '')
  if (!/[-:]+/.test(core)) return false
  const cells = core.split('|')
  return cells.every((c) => /^[\s\-:]+$/.test(c))
}

function splitMarkdownTableCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => normalizeTableCell(c))
}

function looksLikePageCell(cell: string): boolean {
  if (!cell) return true
  if (/^[ivxlcdm]{1,10}$/i.test(cell)) return true
  if (/^\d{1,4}$/.test(cell)) return true
  return false
}

/** Strip trailing dot leaders ("Title . . . . . 12" -> "Title") and a trailing page number. */
function stripDotLeaders(s: string): string {
  return s
    .replace(/(?:\s*[.·․·]){2,}\s*(?:\d+|[ivxlcdm]+)?\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Parse a markdown pipe table row as a TOC entry (multi-column layouts, `<br>` in cells).
 * Handles chapter rows ("| 1. Title . . . | 12 |"), number/title/page rows ("| 1 | Title | 5 |"),
 * and UNNUMBERED sub-entries ("| The Rise of AI Engineering | 2 |") — the page column is never
 * mistaken for a section number.
 */
function parseMarkdownTableTocRow(line: string): { numberKey: string | null; title: string; listDepth: number } | null {
  if (isMarkdownTableSeparator(line)) return null
  if (!looksLikeMarkdownTableRow(line)) return null

  const cells = splitMarkdownTableCells(line)
  if (cells.length < 2) return null

  // The page-number column is the LAST non-empty cell when it looks like a page number. It must
  // never be read as a section number (the bug on unnumbered sub-rows like `| Title | 2 |`).
  let pageIdx = -1
  for (let k = cells.length - 1; k >= 0; k--) {
    if (cells[k]) {
      if (looksLikePageCell(cells[k])) pageIdx = k
      break
    }
  }
  const isPage = (idx: number) => idx === pageIdx

  // (1) "1. Title" embedded in a (non-page) cell — strongest signal.
  let bestEmbedded: { numberKey: string; title: string; score: number } | null = null
  cells.forEach((cell, idx) => {
    if (!cell || isPage(idx)) return
    const embedded = parseNumberedHeadingBody(cell)
    if (embedded) {
      const score = embedded.numberKey.split('.').length * 100 + embedded.title.length
      if (!bestEmbedded || score > bestEmbedded.score) bestEmbedded = { ...embedded, score }
    }
  })
  if (bestEmbedded) {
    return { numberKey: bestEmbedded.numberKey, title: stripDotLeaders(bestEmbedded.title), listDepth: 0 }
  }

  // (2) a standalone section-number cell that is NOT the page column: `| 1 | Title | 5 |`.
  let bestPureNum: string | null = null
  let bestPureIdx = -1
  cells.forEach((cell, idx) => {
    if (isPage(idx)) return
    const m = cell.match(/^(\d+(?:\.\d+)*)$/)
    if (!m) return
    const nk = m[1]
    if (
      !bestPureNum ||
      nk.split('.').length > bestPureNum.split('.').length ||
      (nk.split('.').length === bestPureNum.split('.').length && nk.length > bestPureNum.length)
    ) {
      bestPureNum = nk
      bestPureIdx = idx
    }
  })

  // Title = the longest non-empty cell that isn't the page or the section-number cell.
  let title = ''
  cells.forEach((cell, idx) => {
    if (!cell || isPage(idx) || idx === bestPureIdx) return
    if (looksLikePageCell(cell)) return
    if (cell.length > title.length) title = cell
  })
  title = stripDotLeaders(title)
  if (title.length < 2) return null

  // A numbered chapter/section, or an unnumbered sub-entry (numberKey = null).
  return { numberKey: bestPureNum, title, listDepth: 0 }
}

function stripLeadingBlockquote(line: string): string {
  return line.replace(/^(?:[ \t]*>[ \t]?)+/, '').trim()
}

/** Extract display title from markdown link syntax: `[Title](#anchor)` */
export function stripMarkdownLinkTitle(s: string): string {
  const t = s.trim()
  const link = t.match(/^\[([^\]]+)\]\([^)]*\)$/)
  if (link) return link[1].trim()
  return t
}

function isSkippableTocGapLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/^[-*_]{3,}$/.test(t)) return true
  return false
}

function normalizeOutlineTitle(title: string): string {
  return stripMarkdownLinkTitle(cleanHeadingMarkup(title)).trim()
}

function normalizeLineForHeaderCheck(line: string): string {
  const m = line.match(/^(#{1,6})\s+(.+)$/)
  const body = m ? m[2] : line
  return cleanHeadingMarkup(body).trim().toLowerCase()
}

function isTocHeaderLine(line: string): boolean {
  const t = line.trim()
  const normalized = normalizeLineForHeaderCheck(line)
  if (normalized === "contents" || normalized === "table of contents" || normalized === "toc") {
    return true
  }
  return TOC_HEADER_PATTERNS.some((re) => re.test(t))
}

function isContentsSectionHeader(line: string): boolean {
  return isTocHeaderLine(line)
}

/** Remove dot leaders and trailing page numbers from a textbook TOC line. */
export function stripTocLineTrailers(line: string): string {
  let t = cleanHeadingMarkup(line.replace(/\r$/, "").trim())
  t = t.replace(/\s+[.\u00b7\u2024·\s-]{2,}\s*(\d+|[ivxlcdm]+)\s*$/i, "").trim()
  return t
}

export function isTextbookTocNoiseLine(line: string): boolean {
  const t = cleanHeadingMarkup(line.trim())
  if (!t) return true
  if (/^[ivxlcdm]+$/i.test(t)) return true
  if (/^\d{1,4}$/.test(t)) return true
  if (/^contents\s+[ivxlcdm]+$/i.test(t)) return true
  if (/^[ivxlcdm]+\s+contents$/i.test(t)) return true
  if (/^[xvi]+\s+contents$/i.test(t)) return true
  return false
}

type TextbookParseContext = { lastTopLevelChapter: string | null }

export type TextbookTocLineParsed = {
  numberKey: string | null
  title: string
  listDepth: number
  sectionKey?: string
}

/** Parse a single textbook Contents line (dot leaders, section numbers, Preface/Exercises). */
export function parseTextbookTocLine(
  line: string,
  ctx: TextbookParseContext,
): TextbookTocLineParsed | null {
  if (isTextbookTocNoiseLine(line)) return null

  // Docling often renders a book's Table of Contents as a markdown TABLE (pipe rows with dot
  // leaders + a page column). Handle those here so the Contents-section detector works on table
  // TOCs, not just plain dot-leader text.
  if (looksLikeMarkdownTableRow(line)) {
    return parseMarkdownTableTocRow(line)
  }

  const raw = line.replace(/\r$/, "").trim()
  if (!raw || /^[.\u00b7·\s-]+$/.test(raw)) return null

  const stripped = stripTocLineTrailers(raw)

  const numbered = stripped.match(/^(\d+(?:\.\d+)*)\s+(.+)$/)
  if (numbered) {
    const numberKey = numbered[1]
    let title = numbered[2].trim()
    title = title.replace(/\s+\d{1,4}\s*$/, "").trim()
    if (title.length < 2) return null
    const listDepth = numberKey.split(".").length - 1
    if (/^\d+$/.test(numberKey)) ctx.lastTopLevelChapter = numberKey
    return {
      numberKey,
      title: normalizeOutlineTitle(title),
      listDepth,
    }
  }

  const unnumberedWithPage = stripped.match(/^([A-Za-z][A-Za-z\s\-–—'']+?)\s+(\d+|[ivxlcdm]+)\s*$/i)
  if (unnumberedWithPage) {
    const title = normalizeOutlineTitle(unnumberedWithPage[1])
    if (title.length >= 2) {
      return { numberKey: null, title, listDepth: 0 }
    }
  }

  const titleOnly = normalizeOutlineTitle(stripped)
  if (titleOnly.length >= 2) {
    const lower = titleOnly.toLowerCase()
    if (lower === "exercises" && ctx.lastTopLevelChapter) {
      return {
        numberKey: null,
        title: titleOnly,
        listDepth: 1,
        sectionKey: `toc:${ctx.lastTopLevelChapter}/exercises`,
      }
    }
    if (lower === "preface" || lower === "bibliography" || lower === "index") {
      return { numberKey: null, title: titleOnly, listDepth: 0 }
    }
    if (/[.\u00b7·\s-]{2,}\s*(\d+|[ivxlcdm]+)\s*$/i.test(raw)) {
      return { numberKey: null, title: titleOnly, listDepth: 0 }
    }
  }

  return null
}

function isBodyChapterStartHeading(line: string): boolean {
  const m = line.match(/^(#{1,6})\s+(.+)$/)
  if (!m) return false
  if (/[.\u00b7·]\s*[.\u00b7·]/.test(m[2])) return false
  const body = stripTocLineTrailers(m[2])
  return /^\d+\s+[A-Za-z]/.test(body)
}

function charOffsetForLineIndex(lines: string[], lineIndex: number): number {
  let charOffset = 0
  for (let k = 0; k < lineIndex; k++) {
    charOffset += lines[k].length + 1
  }
  return charOffset
}

function pushTextbookTocEntry(
  entries: TocEntry[],
  parsed: TextbookTocLineParsed,
): void {
  const sectionKey =
    parsed.sectionKey ?? makeSectionKey(parsed.numberKey, parsed.title, entries.length)
  entries.push({
    numberKey: parsed.numberKey,
    title: parsed.title,
    sectionKey,
    listDepth: parsed.listDepth,
  })
}

/**
 * Find and parse a mid-document Contents section (textbook dot-leader TOC).
 */
export function detectContentsSection(text: string): TocBlock | null {
  if (!text || text.length < 40) return null

  const lines = text.split("\n")

  for (let i = 0; i < lines.length; i++) {
    if (!isContentsSectionHeader(lines[i])) continue

    let j = i + 1
    while (j < lines.length && !lines[j].trim()) j++

    const entries: TocEntry[] = []
    const ctx: TextbookParseContext = { lastTopLevelChapter: null }
    let scanned = 0
    let consecutiveNonToc = 0

    while (j < lines.length && scanned < MAX_CONTENTS_SCAN_LINES) {
      const line = lines[j]
      scanned++

      if (!line.trim()) {
        if (entries.length >= MIN_CONTENTS_ENTRIES) {
          consecutiveNonToc++
          if (consecutiveNonToc >= CONTENTS_STOP_NON_TOC) break
        }
        j++
        continue
      }

      const parsed = parseTextbookTocLine(line, ctx)
      if (!parsed) {
        if (entries.length >= MIN_CONTENTS_ENTRIES) {
          consecutiveNonToc++
          if (consecutiveNonToc >= CONTENTS_STOP_NON_TOC) break
        }
        j++
        continue
      }

      consecutiveNonToc = 0
      pushTextbookTocEntry(entries, parsed)
      j++
    }

    const numberedCount = entries.filter((e) => e.numberKey).length
    if (entries.length >= MIN_TOC_ENTRIES && numberedCount >= MIN_CONTENTS_NUMBERED) {
      while (j < lines.length && !lines[j].trim()) j++
      return { entries, bodyCharStart: charOffsetForLineIndex(lines, j) }
    }
  }

  return null
}

/**
 * Lines that look like a single TOC outline row (not the header line).
 */
function parseOutlineLine(line: string): { numberKey: string | null; title: string; listDepth: number } | null {
  const raw = line.replace(/\r$/, '')
  if (!raw.trim()) return null

  if (looksLikeMarkdownTableRow(raw)) {
    const tableParsed = parseMarkdownTableTocRow(raw)
    if (tableParsed) return tableParsed
  }

  const unquoted = stripLeadingBlockquote(raw)

  const textbookCtx: TextbookParseContext = { lastTopLevelChapter: null }
  const textbook = parseTextbookTocLine(unquoted, textbookCtx)
  if (textbook) return textbook

  const listMatch = unquoted.match(/^(\s*)([-*+])\s+(.*)$/)
  if (listMatch) {
    const indent = listMatch[1].length
    const depth = Math.floor(indent / 2)
    const rest = normalizeOutlineTitle(listMatch[3].trim())
    if (!rest) return null
    const numTitle = rest.match(/^(\d+(?:\.\d+)*)\s*[.:)\-–]?\s+(.+)$/)
    if (numTitle) {
      return { numberKey: numTitle[1], title: numTitle[2].trim(), listDepth: depth }
    }
    const chap = rest.match(/^chapter\s+(\d+)\s*[.:)\-–]?\s*(.*)$/i)
    if (chap) {
      const t = chap[2]?.trim() || rest
      return { numberKey: chap[1], title: t, listDepth: depth }
    }
    return { numberKey: null, title: rest, listDepth: depth }
  }

  const partMatch = unquoted.match(/^\s*(part|section|appendix)\s+([ivxlcdm]+|\d+|[a-z])\s*[.:)\-–]?\s*(.+)$/i)
  if (partMatch) {
    const prefix = partMatch[1].toLowerCase()
    const id = partMatch[2].toLowerCase()
    const title = normalizeOutlineTitle(partMatch[3])
    if (title.length >= 2) {
      return { numberKey: `${prefix}-${id}`, title, listDepth: 0 }
    }
  }

  const roman = unquoted.match(/^\s*([IVXLCDM]+)\.\s+(.+)$/i)
  if (roman) {
    const title = normalizeOutlineTitle(roman[2])
    if (title.length >= 2) {
      return { numberKey: `roman-${roman[1].toLowerCase()}`, title, listDepth: 0 }
    }
  }

  const chapterOnly = unquoted.match(/^\s*chapter\s+(\d+)\s*[.:)\-–]?\s*(.*)$/i)
  if (chapterOnly) {
    const titlePart = chapterOnly[2]?.trim()
    if (titlePart) return { numberKey: chapterOnly[1], title: titlePart, listDepth: 0 }
  }

  const tabbed = unquoted.match(/^\s*(\d+(?:\.\d+)*)\t+\s*(.+)$/)
  if (tabbed) {
    return { numberKey: tabbed[1], title: tabbed[2].trim(), listDepth: 0 }
  }

  return null
}

/**
 * If the first non-empty lines look like a TOC, parse entries and return body start offset.
 */
export function detectTocBlock(text: string): TocBlock | null {
  if (!text || text.length < 20) return null

  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i >= lines.length) return null

  let startedWithHeader = isTocHeaderLine(lines[i])
  if (startedWithHeader) {
    i++
    while (i < lines.length && !lines[i].trim()) i++
  }

  const entries: TocEntry[] = []
  let scanned = 0
  let consecutiveNonToc = 0
  let leadingSkipsWithoutHeader = 0

  while (i < lines.length && scanned < MAX_TOC_SCAN_LINES) {
    const line = lines[i]
    scanned++

    if (!line.trim()) {
      if (entries.length >= MIN_TOC_ENTRIES) {
        consecutiveNonToc++
        if (consecutiveNonToc >= 5) break
      }
      if (entries.length === 0 && !startedWithHeader && leadingSkipsWithoutHeader < 6) {
        leadingSkipsWithoutHeader++
        i++
        continue
      }
      i++
      continue
    }
    consecutiveNonToc = 0

    const parsed = parseOutlineLine(line)
    if (!parsed) {
      if (entries.length >= MIN_TOC_ENTRIES) break
      if (startedWithHeader) {
        if (entries.length === 0 && isSkippableTocGapLine(line)) {
          i++
          continue
        }
        i++
        continue
      }
      const allowLeadingSkip =
        leadingSkipsWithoutHeader < MAX_TOC_LEADING_SKIP &&
        (looksLikeMarkdownTableRow(line) || isMarkdownTableSeparator(line))
      if (allowLeadingSkip) {
        leadingSkipsWithoutHeader++
        i++
        continue
      }
      return null
    }

    leadingSkipsWithoutHeader = 0

    const sectionKey = makeSectionKey(parsed.numberKey, parsed.title, entries.length)
    entries.push({
      numberKey: parsed.numberKey,
      title: normalizeOutlineTitle(parsed.title),
      sectionKey,
      listDepth: parsed.listDepth,
    })
    i++
  }

  if (entries.length < MIN_TOC_ENTRIES) return null

  while (i < lines.length && !lines[i].trim()) i++

  let bodyLineIndex = i
  let charOffset = 0
  for (let k = 0; k < bodyLineIndex; k++) {
    charOffset += lines[k].length + 1
  }
  return { entries, bodyCharStart: charOffset }
}

/**
 * Infer outline from numbered ATX headings in the full document (no leading TOC).
 * Used for academic/PDF-export markdown like `#### **1.1.1 Why Probabilities?**`.
 */
export function detectOutlineFromHeadings(text: string): TocBlock | null {
  if (!text || text.length < 40) return null

  const lines = text.split('\n')
  const seenKeys = new Set<string>()
  const entries: TocEntry[] = []

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)$/)
    if (!m) continue
    const cleaned = cleanHeadingMarkup(m[2].trim())
    const parsed = parseNumberedHeadingBody(cleaned)
    if (!parsed) continue
    const sectionKey = makeSectionKey(parsed.numberKey, parsed.title, entries.length)
    if (seenKeys.has(sectionKey)) continue
    seenKeys.add(sectionKey)
    entries.push({
      numberKey: parsed.numberKey,
      title: parsed.title,
      sectionKey,
      listDepth: 0,
    })
  }

  if (entries.length < MIN_TOC_ENTRIES) return null
  const hasHierarchicalNumber = entries.some((e) => e.numberKey && e.numberKey.includes('.'))
  if (hasHierarchicalNumber) return { entries, bodyCharStart: 0 }

  const integerChapters = entries.filter((e) => e.numberKey && /^\d+$/.test(e.numberKey))
  if (integerChapters.length >= MIN_HEADING_LEVEL_ENTRIES) {
    return { entries, bodyCharStart: 0 }
  }

  return null
}

/**
 * Infer outline from ATX heading depth when titles are unnumbered (native Markdown).
 */
export function detectOutlineFromHeadingLevels(text: string): TocBlock | null {
  if (!text || text.length < 40) return null

  const lines = text.split('\n')
  type HeadingCandidate = { level: number; title: string }
  const candidates: HeadingCandidate[] = []

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)$/)
    if (!m) continue
    const title = cleanHeadingMarkup(m[2].trim())
    if (title.length < 2) continue
    if (/^\d+$/.test(title.replace(/\s+/g, ""))) continue
    candidates.push({ level: m[1].length, title })
  }

  if (candidates.length < MIN_HEADING_LEVEL_ENTRIES) return null

  let startIdx = 0
  if (candidates.length >= 6 && candidates[0].level === 1) {
    const following = candidates.slice(1)
    if (following.length >= 5) startIdx = 1
  } else if (candidates.length >= 2 && candidates[0].level === 1) {
    const h1Count = candidates.filter((c) => c.level === 1).length
    const hasDeeper = candidates.some((c) => c.level >= 2)
    if (h1Count === 1 && hasDeeper) startIdx = 1
  }

  const headings = candidates.slice(startIdx)
  if (headings.length < MIN_HEADING_LEVEL_ENTRIES) return null

  const minLevel = Math.min(...headings.map((h) => h.level))
  const relativeDepths = new Set(headings.map((h) => h.level - minLevel))
  if (relativeDepths.size < 2) return null

  const slugStack: string[] = []
  const entries: TocEntry[] = []
  const seenKeys = new Set<string>()

  for (const h of headings) {
    const listDepth = h.level - minLevel
    const slug = slugKey(h.title, entries.length)
    while (slugStack.length > listDepth) slugStack.pop()
    slugStack[listDepth] = slug
    const pathParts = slugStack.slice(0, listDepth + 1)
    const sectionKey = `toc:${pathParts.join('/')}`

    if (seenKeys.has(sectionKey)) continue
    seenKeys.add(sectionKey)
    entries.push({
      numberKey: null,
      title: h.title,
      sectionKey,
      listDepth,
    })
  }

  if (entries.length < MIN_HEADING_LEVEL_ENTRIES) return null
  return { entries, bodyCharStart: 0 }
}

/**
 * Candidate outlines from every detector, in descending trust order. A leading
 * TOC/Contents list is normally most accurate, but PDF→markdown conversion can
 * truncate it (the Pearl book's Contents yielded 28 entries covering only ch.1–2,
 * while the numbered headings cover all 10 chapters with 181). So callers pick the
 * *most complete* candidate, not just the first non-null — otherwise whole chapters
 * fall outside the outline and their content collapses onto an early section.
 */
function outlineCandidates(
  text: string,
): Array<{ source: Exclude<TocAnalysisSource, 'none' | 'llm_inferred'>; block: TocBlock }> {
  const out: Array<{ source: Exclude<TocAnalysisSource, 'none' | 'llm_inferred'>; block: TocBlock }> = []
  const push = (
    source: Exclude<TocAnalysisSource, 'none' | 'llm_inferred'>,
    block: TocBlock | null,
  ) => {
    if (block) out.push({ source, block })
  }
  push('toc_block', detectTocBlock(text))
  push('contents_section', detectContentsSection(text))
  push('heading_outline', detectOutlineFromHeadings(text))
  push('heading_levels', detectOutlineFromHeadingLevels(text))
  return out
}

// A lower-trust detector overrides a higher-trust one only when it's this many
// times larger — i.e. the trusted TOC was clearly *truncated* (Pearl: 28→181, a
// 6.5× gap), not merely a couple entries different (a 2-entry TOC vs a 3-node
// heading-level tree that miscounts "# Body"/"# Contents" as sections).
const OUTLINE_OVERRIDE_RATIO = 1.5

/**
 * Pick the outline to use. Candidates come in descending trust order; keep the
 * most-trusted one unless a later detector is substantially more complete.
 */
function mostCompleteOutline(
  candidates: ReturnType<typeof outlineCandidates>,
): { source: Exclude<TocAnalysisSource, 'none' | 'llm_inferred'>; block: TocBlock } | null {
  if (candidates.length === 0) return null
  return candidates.reduce((best, c) =>
    c.block.entries.length > best.block.entries.length * OUTLINE_OVERRIDE_RATIO ? c : best,
  )
}

/**
 * Resolve document outline using all heuristic detectors, preferring completeness.
 */
export function resolveDocumentOutline(text: string): TocBlock | null {
  return mostCompleteOutline(outlineCandidates(text))?.block ?? null
}

export type TocAnalysisSource =
  | 'none'
  | 'pdf_outline'
  | 'toc_block'
  | 'contents_section'
  | 'heading_outline'
  | 'heading_levels'
  | 'llm_inferred'

export type TocAnalysisResult = {
  source: TocAnalysisSource
  entryCount: number
  entries: TocEntry[]
  bodyStartsAtChar: number | null
  /** Plain-text lines for UI (no markdown) */
  lines: string[]
}

function formatTocEntryLine(e: TocEntry): string {
  const label = e.numberKey ? `${e.numberKey}  ${e.title}` : e.title
  return `  ${e.sectionKey}  →  ${label}`
}

function analysisLinesForBlock(source: TocAnalysisSource, block: TocBlock): string[] {
  if (source === 'pdf_outline') {
    return [
      `Detected: the PDF's embedded outline / bookmarks (${block.entries.length} sections).`,
      'This is the document’s own table of contents — the most reliable source.',
      '',
      'Parsed sections:',
      ...block.entries.map(formatTocEntryLine),
    ]
  }
  if (source === 'toc_block') {
    return [
      `Detected: TOC block at the start of the file (${block.entries.length} section${block.entries.length === 1 ? '' : 's'}).`,
      `Main body starts at character index ${block.bodyCharStart} (0-based).`,
      '',
      'Parsed sections:',
      ...block.entries.map(formatTocEntryLine),
    ]
  }
  if (source === 'contents_section') {
    return [
      `Detected: textbook Contents section (${block.entries.length} sections at full depth).`,
      `Main body starts at character index ${block.bodyCharStart} (0-based).`,
      '',
      'Parsed sections:',
      ...block.entries.map(formatTocEntryLine),
    ]
  }
  if (source === 'heading_outline') {
    return [
      `Detected: numbered markdown headings (${block.entries.length} outline nodes).`,
      'No leading TOC list/table was required; section IDs come from heading text.',
      '',
      'Parsed sections:',
      ...block.entries.map(formatTocEntryLine),
    ]
  }
  if (source === 'heading_levels') {
    return [
      `Detected: heading-level hierarchy (${block.entries.length} sections from # depth).`,
      'Unnumbered ATX headings were nested by markdown level (#, ##, ###, …).',
      '',
      'Parsed sections:',
      ...block.entries.map(formatTocEntryLine),
    ]
  }
  if (source === 'llm_inferred') {
    return [
      `Detected: LLM-inferred outline (${block.entries.length} sections).`,
      'Review sections before processing; inference may miss or merge topics.',
      '',
      'Parsed sections:',
      ...block.entries.map(formatTocEntryLine),
    ]
  }
  return []
}

/** Build a TocAnalysisResult from a PDF's embedded outline entries (the document's own TOC). */
export function buildOutlineAnalysis(entries: TocEntry[]): TocAnalysisResult {
  return buildTocAnalysisResult('pdf_outline', { entries, bodyCharStart: 0 })
}

/** Build a TocAnalysisResult from a resolved block (used by heuristics and LLM). */
export function buildTocAnalysisResult(
  source: Exclude<TocAnalysisSource, 'none'>,
  block: TocBlock,
): TocAnalysisResult {
  return {
    source,
    entryCount: block.entries.length,
    entries: block.entries,
    bodyStartsAtChar: block.bodyCharStart,
    lines: analysisLinesForBlock(source, block),
  }
}

function detectOutlineSource(text: string): { source: Exclude<TocAnalysisSource, 'none'>; block: TocBlock } | null {
  // Same "most complete wins" rule as resolveDocumentOutline, so the TOC preview
  // dialog reports exactly the outline extraction will use.
  return mostCompleteOutline(outlineCandidates(text))
}

/**
 * Inspect document text for a TOC block or numbered heading outline (same rules as extraction).
 * For use in the UI preview dialog.
 */
export function analyzeDocumentToc(text: string): TocAnalysisResult {
  if (!text?.trim()) {
    return {
      source: 'none',
      entryCount: 0,
      entries: [],
      bodyStartsAtChar: null,
      lines: ['Document text is empty.'],
    }
  }

  const detected = detectOutlineSource(text)
  if (detected) {
    return buildTocAnalysisResult(detected.source, detected.block)
  }

  return {
    source: 'none',
    entryCount: 0,
    entries: [],
    bodyStartsAtChar: null,
    lines: [
      'No TOC-style outline was detected.',
      '',
      'You can add:',
      '• A Table of Contents block at the top (markdown list, plain numbered lines, or a pipe table with section numbers), or',
      '• Numbered markdown headings (e.g. ## 1.1.1 Why …), or',
      '• A heading hierarchy using # / ## / ### without section numbers, or',
      '• Click “Infer TOC with LLM” below to infer structure from the document.',
    ],
  }
}

/**
 * Emit has_subsection edges for every numeric prefix so `toc:1.1.1` implies
 * `toc:root → toc:1 → toc:1.1 → toc:1.1.1` even when intermediate headings are absent.
 */
function numberPrefixChainTriples(entries: TocEntry[]): Triple[] {
  const edgeKey = new Set<string>()
  const out: Triple[] = []
  for (const e of entries) {
    if (!e.numberKey) continue
    const parts = e.numberKey.split('.')
    for (let depth = 1; depth <= parts.length; depth++) {
      const childNk = parts.slice(0, depth).join('.')
      const parentNk = depth > 1 ? parts.slice(0, depth - 1).join('.') : ''
      const childKey = `toc:${childNk}`
      const parentKey = parentNk ? `toc:${parentNk}` : TOC_ROOT_KEY
      const k = `${parentKey}|${TOC_SUBSECTION_PREDICATE}|${childKey}`
      if (edgeKey.has(k)) continue
      edgeKey.add(k)
      out.push({
        subject: parentKey,
        predicate: TOC_SUBSECTION_PREDICATE,
        object: childKey,
      })
    }
  }
  return out
}

function parentNumberKey(numberKey: string): string | null {
  const parts = numberKey.split('.')
  if (parts.length <= 1) return null
  parts.pop()
  return parts.join('.')
}

function immediateParentSectionKey(entry: TocEntry, index: number, entries: TocEntry[]): string {
  if (entry.numberKey) {
    const p = parentNumberKey(entry.numberKey)
    return p ? `toc:${p}` : TOC_ROOT_KEY
  }

  for (let j = index - 1; j >= 0; j--) {
    const prev = entries[j]
    if (prev.listDepth < entry.listDepth) return prev.sectionKey
  }
  return TOC_ROOT_KEY
}

/**
 * Deterministic hierarchy triples: (parent, has_subsection, child).
 */
export function tocStructuralTriples(entries: TocEntry[]): Triple[] {
  const triples: Triple[] = []

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const parentKey = immediateParentSectionKey(e, i, entries)
    triples.push({
      subject: parentKey,
      predicate: TOC_SUBSECTION_PREDICATE,
      object: e.sectionKey,
    })
  }

  const seen = new Set<string>()
  return triples.filter((t) => {
    const k = `${t.subject}|${t.predicate}|${t.object}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function extractLeadingNumberFromHeading(headingText: string): string | null {
  const stripped = headingText.replace(/^#{1,6}\s+/, '').trim()
  const cleaned = cleanHeadingMarkup(stripped)
  const m = cleaned.match(/^(\d+(?:\.\d+)*)\s*[.:)\-–]?\s+/i)
  return m ? m[1] : null
}

function matchHeadingToEntry(headingText: string, entries: TocEntry[]): TocEntry | null {
  const headNum = extractLeadingNumberFromHeading(headingText)
  if (headNum) {
    for (const e of entries) {
      if (e.numberKey === headNum) return e
    }
    // A numbered heading's identity is its number. If that number isn't in the
    // outline it's a *different* section (typically a chapter the outline missed) —
    // never fall back to title matching, or every "3.1 Introduction", "4.1
    // Introduction", … collapses onto the one entry titled "Introduction" (toc:2.1),
    // funnelling whole chapters of entities onto a single section.
    return null
  }

  const normH = normalizeTitle(headingText)
  if (normH.length < 2) return null

  for (const e of entries) {
    const nt = normalizeTitle(e.title)
    if (nt && normH === nt) return e
  }
  for (const e of entries) {
    const nt = normalizeTitle(e.title)
    if (nt.length >= 4 && (normH.includes(nt) || nt.includes(normH))) return e
  }
  return null
}

/** True when `ancestor` is the same section or a numeric/path parent of `child`. */
export function isAncestorSectionKey(ancestor: string, child: string): boolean {
  if (ancestor === child) return true
  if (ancestor === TOC_ROOT_KEY) return true
  const a = ancestor.startsWith('toc:') ? ancestor.slice(4) : ancestor
  const c = child.startsWith('toc:') ? child.slice(4) : child
  if (/^\d+(?:\.\d+)*$/.test(a) && /^\d+(?:\.\d+)*$/.test(c)) {
    return c === a || c.startsWith(`${a}.`)
  }
  return child.startsWith(`${ancestor}/`)
}

function isLikelyBodySectionStartLine(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 200) return false
  if (/^#{1,6}\s+\S/.test(t)) return true
  const cleaned = cleanHeadingMarkup(t)
  if (/^\d+(?:\.\d+)*\s+[A-Za-z]/.test(cleaned)) return true
  if (/^chapter\s+\d+\s/i.test(cleaned)) return true
  return false
}

function lineHeadingText(line: string): string {
  const m = line.trim().match(/^(#{1,6})\s+(.+)$/)
  return m ? m[2].trim() : line.trim()
}

type HeadingHit = { charStart: number; charEnd: number; headingText: string; entry: TocEntry }

/**
 * Scan markdown body for section starts (ATX headings and plain numbered lines) and match to TOC entries.
 */
export function findMatchedHeadingSpans(body: string, entries: TocEntry[]): HeadingHit[] {
  const lines = body.split('\n')
  let offset = 0
  const hits: HeadingHit[] = []
  const seenAtOffset = new Set<number>()

  for (const line of lines) {
    if (isLikelyBodySectionStartLine(line)) {
      const title = lineHeadingText(line)
      const entry = matchHeadingToEntry(title, entries)
      if (entry && !seenAtOffset.has(offset)) {
        seenAtOffset.add(offset)
        hits.push({
          charStart: offset,
          charEnd: offset + line.length + 1,
          headingText: title,
          entry,
        })
      }
    }
    offset += line.length + 1
  }
  return hits
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Fallback: locate section starts in the body by searching for TOC number keys at line boundaries.
 */
function findBoundaryHitsForEntries(body: string, entries: TocEntry[]): HeadingHit[] {
  const hits: HeadingHit[] = []
  const seenKeys = new Set<string>()

  for (const entry of entries) {
    if (!entry.numberKey || seenKeys.has(entry.sectionKey)) continue
    const nk = escapeRegExp(entry.numberKey)
    const patterns = [
      new RegExp(`^#{1,6}\\s+(?:\\*\\*)?${nk}(?:\\*\\*)?\\s*[.:)\\-–]?\\s+\\S`, 'im'),
      new RegExp(`^${nk}\\s+[.:)\\-–]?\\s+\\S`, 'im'),
    ]
    for (const re of patterns) {
      const m = re.exec(body)
      if (m && m.index !== undefined) {
        seenKeys.add(entry.sectionKey)
        const lineEnd = body.indexOf('\n', m.index)
        hits.push({
          charStart: m.index,
          charEnd: lineEnd === -1 ? body.length : lineEnd + 1,
          headingText: body.slice(m.index, lineEnd === -1 ? body.length : lineEnd).trim(),
          entry,
        })
        break
      }
    }
  }

  return hits.sort((a, b) => a.charStart - b.charStart)
}

export type BodySectionSlice = {
  sectionKey: string
  text: string
  matched: boolean
}

/**
 * Split body into slices: preamble (before first matched heading), then each span until next heading.
 */
export function splitBodyIntoSections(body: string, entries: TocEntry[], hits: HeadingHit[]): BodySectionSlice[] {
  const slices: BodySectionSlice[] = []
  if (hits.length === 0) return slices

  const preamble = body.slice(0, hits[0].charStart).trim()
  if (preamble) {
    slices.push({ sectionKey: TOC_ROOT_KEY, text: preamble, matched: false })
  }

  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].charEnd
    const end = i + 1 < hits.length ? hits[i + 1].charStart : body.length
    const text = body.slice(start, end).trim()
    slices.push({
      sectionKey: hits[i].entry.sectionKey,
      text,
      matched: true,
    })
  }
  return slices
}

export type TocTreeNode = {
  sectionKey: string
  title: string
  numberKey: string | null
  depth: number
  children: TocTreeNode[]
}

/** Build nested tree from flat TOC entries (for section selector UI). */
export function buildTocTree(entries: TocEntry[]): TocTreeNode[] {
  if (entries.length === 0) return []

  // De-dup nodes by sectionKey: a stray heading that slugifies to a bare number
  // (e.g. "1" -> "toc:1") can collide with a numbered section's key, and entries
  // can repeat. One node per key, attached once.
  const nodeByKey = new Map<string, TocTreeNode>()
  for (const e of entries) {
    if (!nodeByKey.has(e.sectionKey)) {
      nodeByKey.set(e.sectionKey, {
        sectionKey: e.sectionKey,
        title: e.title,
        numberKey: e.numberKey,
        depth: 0,
        children: [],
      })
    }
  }

  const roots: TocTreeNode[] = []
  const placed = new Set<TocTreeNode>()
  const parentOf = new Map<TocTreeNode, TocTreeNode>()

  // Would making `node` a child of `parent` create a cycle? (i.e. parent is
  // already in node's subtree). Walk up parent's ancestry; hitting node => cycle.
  const wouldCycle = (parent: TocTreeNode, node: TocTreeNode): boolean => {
    let cur: TocTreeNode | undefined = parent
    while (cur) {
      if (cur === node) return true
      cur = parentOf.get(cur)
    }
    return false
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const node = nodeByKey.get(e.sectionKey)!
    if (placed.has(node)) continue // shared/duplicate key — attach the node once
    const parentKey = immediateParentSectionKey(e, i, entries)
    const parent = parentKey === TOC_ROOT_KEY ? undefined : nodeByKey.get(parentKey)
    if (parent && parent !== node && !wouldCycle(parent, node)) {
      parent.children.push(node)
      parentOf.set(node, parent)
    } else {
      roots.push(node)
    }
    placed.add(node)
  }

  // seen-guard is belt-and-suspenders: construction above is already acyclic.
  const setDepth = (nodes: TocTreeNode[], depth: number, seen: Set<TocTreeNode>) => {
    for (const n of nodes) {
      if (seen.has(n)) continue
      seen.add(n)
      n.depth = depth
      setDepth(n.children, depth + 1, seen)
    }
  }
  setDepth(roots, 0, new Set())
  return roots
}

/** All section keys in a subtree (node + descendants), de-duplicated and cycle-safe. */
export function collectDescendantKeys(node: TocTreeNode): string[] {
  const keys: string[] = []
  const seen = new Set<TocTreeNode>()
  const walk = (n: TocTreeNode) => {
    if (seen.has(n)) return
    seen.add(n)
    keys.push(n.sectionKey)
    for (const child of n.children) walk(child)
  }
  walk(node)
  return keys
}

/** Flat list of all section keys from entries. */
export function allSectionKeysFromEntries(entries: TocEntry[]): string[] {
  return entries.map((e) => e.sectionKey)
}

/** null/undefined selectedSet means all sections selected. */
export function isSliceSelected(sliceKey: string, selectedSet: Set<string> | null): boolean {
  if (selectedSet === null) return true
  if (selectedSet.size === 0) return false
  if (selectedSet.has(sliceKey)) return true
  for (const key of selectedSet) {
    if (isAncestorSectionKey(key, sliceKey) || isAncestorSectionKey(sliceKey, key)) {
      return true
    }
  }
  return false
}

export type ChunkCountOptions = {
  chunkSize: number
  overlapSize: number
  usePygChunking: boolean
}

/** Count chunks for text without calling the LLM. */
export function countChunksForText(text: string, opts: ChunkCountOptions): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  if (trimmed.length <= opts.chunkSize) return 1
  const chunks = opts.usePygChunking
    ? chunkTextPyG(trimmed, opts.chunkSize, opts.overlapSize)
    : chunkText(trimmed, opts.chunkSize)
  return Math.max(1, chunks.length)
}

export type ExtractProgressEvent = {
  completedChunks: number
  totalChunks: number
  sectionKey?: string
  sectionTitle?: string
}

function sectionEntityLinkTriples(sectionKey: string, triples: Triple[]): Triple[] {
  const seenNorm = new Set<string>()
  const entities: string[] = []
  const add = (raw: unknown) => {
    if (raw == null) return
    const s = String(raw).trim()
    if (!s) return
    const k = s.toLowerCase()
    if (seenNorm.has(k)) return
    seenNorm.add(k)
    entities.push(s)
  }
  for (const t of triples) {
    add(t.subject)
    add(t.object)
  }
  return entities.map((e) => ({
    subject: sectionKey,
    predicate: SECTION_MENTIONS_PREDICATE,
    object: e,
  }))
}

export type ExtractWithTocOptions = {
  chunkSize: number
  overlapSize: number
  usePygChunking: boolean
  extractTriplesFn: (chunk: string) => Promise<Triple[]>
  /** Pre-resolved outline (e.g. from LLM inference during extraction). */
  tocOverride?: TocBlock | null
  /** When null/undefined, all sections are extracted. Structural triples always include full outline. */
  selectedSectionKeys?: string[] | null
  onProgress?: (event: ExtractProgressEvent) => void
  signal?: AbortSignal
}

export type TocExtractionResult = {
  triples: Triple[]
  usedToc: boolean
  sectionAlignment: boolean
}

function chunkOptionsFromExtract(opts: ExtractWithTocOptions): ChunkCountOptions {
  return {
    chunkSize: opts.chunkSize,
    overlapSize: opts.overlapSize,
    usePygChunking: opts.usePygChunking,
  }
}

function makeProgressTracker(
  opts: ExtractWithTocOptions,
  totalChunks: number,
  startCompleted = 0,
): {
  extractWithProgress: (
    chunk: string,
    meta?: { sectionKey?: string; sectionTitle?: string },
  ) => Promise<Triple[]>
  getCompleted: () => number
} {
  let completed = startCompleted
  const extractWithProgress = async (
    chunk: string,
    meta?: { sectionKey?: string; sectionTitle?: string },
  ): Promise<Triple[]> => {
    if (opts.signal?.aborted) {
      throw new DOMException('Extraction aborted', 'AbortError')
    }
    const triples = await opts.extractTriplesFn(chunk)
    completed += 1
    opts.onProgress?.({
      completedChunks: completed,
      totalChunks,
      sectionKey: meta?.sectionKey,
      sectionTitle: meta?.sectionTitle,
    })
    return triples
  }
  return { extractWithProgress, getCompleted: () => completed }
}

/**
 * Run `run` over chunks with bounded concurrency, per-chunk retry, and failure
 * isolation. Replaces `Promise.all(chunks.map(run))`, which fired a request for
 * every chunk at once (flooding the browser/server → dropped connections /
 * "NetworkError") and was fail-fast (one dropped chunk discarded the whole run).
 *
 * Abort is never swallowed — an AbortError from any chunk propagates so the user's
 * cancel still stops processing. A chunk that fails for any other reason after
 * retries yields `[]`, so the rest of the document still extracts and persists.
 */
async function runChunksBounded(
  chunks: string[],
  run: (chunk: string) => Promise<Triple[]>,
  { concurrency = 4, retries = 2 }: { concurrency?: number; retries?: number } = {},
): Promise<Triple[][]> {
  const results: Triple[][] = chunks.map(() => [])
  let nextIndex = 0
  let failedCount = 0

  const isAbort = (err: unknown): boolean =>
    (err instanceof DOMException && err.name === 'AbortError') ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError')

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++
      if (i >= chunks.length) return
      for (let attempt = 0; ; attempt++) {
        try {
          results[i] = await run(chunks[i])
          break
        } catch (err) {
          if (isAbort(err)) throw err // cancel must stop the whole run
          if (attempt >= retries) {
            console.error(`[toc] chunk ${i + 1}/${chunks.length} failed after ${attempt + 1} attempts; skipping:`, err)
            failedCount += 1
            break
          }
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), chunks.length) }, () => worker()),
  )
  if (failedCount > 0) {
    console.warn(`[toc] ${failedCount}/${chunks.length} chunks failed and were skipped (their triples are missing).`)
  }
  return results
}

async function extractWholeDocument(
  text: string,
  opts: ExtractWithTocOptions,
  progressOffset?: { completed: number; total: number },
): Promise<Triple[]> {
  const { chunkSize, overlapSize, usePygChunking } = opts
  const trimmed = text.trim()
  if (!trimmed) return []

  const chunkOpts = chunkOptionsFromExtract(opts)
  const localTotal = countChunksForText(trimmed, chunkOpts)
  const totalChunks = progressOffset?.total ?? localTotal
  const startCompleted = progressOffset?.completed ?? 0
  const { extractWithProgress } = makeProgressTracker(opts, totalChunks, startCompleted)

  if (trimmed.length <= chunkSize) {
    return extractWithProgress(trimmed)
  }
  const chunks = usePygChunking ? chunkTextPyG(trimmed, chunkSize, overlapSize) : chunkText(trimmed, chunkSize)
  const arrays = await runChunksBounded(chunks, (c) => extractWithProgress(c))
  return mergeTriples(arrays)
}

function resolveSelectedSet(selectedSectionKeys?: string[] | null): Set<string> | null {
  if (selectedSectionKeys == null) return null
  if (selectedSectionKeys.length === 0) return new Set()
  return new Set(selectedSectionKeys)
}

function countSelectedSliceChunks(
  slices: BodySectionSlice[],
  selectedSet: Set<string> | null,
  chunkOpts: ChunkCountOptions,
): number {
  let total = 0
  for (const slice of slices) {
    if (!slice.text.trim()) continue
    if (!isSliceSelected(slice.sectionKey, selectedSet)) continue
    total += countChunksForText(slice.text, chunkOpts)
  }
  return total
}

function sectionTitleForKey(sectionKey: string, entries: TocEntry[]): string | undefined {
  if (sectionKey === TOC_ROOT_KEY) return 'Preamble'
  return entries.find((e) => e.sectionKey === sectionKey)?.title
}

/**
 * Main entry: TOC structural triples + optional section-aligned extraction + section_mentions links.
 */
export async function extractDocumentWithOptionalToc(
  fullText: string,
  opts: ExtractWithTocOptions,
): Promise<TocExtractionResult> {
  const selectedSet = resolveSelectedSet(opts.selectedSectionKeys)
  const chunkOpts = chunkOptionsFromExtract(opts)

  const toc =
    opts.tocOverride !== undefined ? opts.tocOverride : resolveDocumentOutline(fullText)
  if (!toc) {
    const totalChunks = countChunksForText(fullText, chunkOpts)
    opts.onProgress?.({ completedChunks: 0, totalChunks })
    const triples = await extractWholeDocument(fullText, opts, { completed: 0, total: totalChunks })
    return { triples, usedToc: false, sectionAlignment: false }
  }

  const structural = mergeTriples([
    numberPrefixChainTriples(toc.entries),
    tocStructuralTriples(toc.entries),
  ])
  const body = fullText.slice(toc.bodyCharStart)

  const extractAlignedSections = async (
    slices: BodySectionSlice[],
    sectionAlignment: boolean,
  ): Promise<TocExtractionResult> => {
    const totalChunks = countSelectedSliceChunks(slices, selectedSet, chunkOpts)
    opts.onProgress?.({ completedChunks: 0, totalChunks })

    if (totalChunks === 0 && selectedSet !== null && selectedSet.size > 0) {
      console.warn(
        '[toc] Selected sections had no matching body text (headings may not align with the TOC). ' +
          'Only structural has_subsection triples were stored.',
      )
      return {
        triples: structural,
        usedToc: true,
        sectionAlignment,
      }
    }

    const groupArrays: Triple[][] = [structural]
    const { extractWithProgress } = makeProgressTracker(opts, totalChunks, 0)

    for (const slice of slices) {
      if (!slice.text.trim()) continue
      if (!isSliceSelected(slice.sectionKey, selectedSet)) continue

      const sectionTitle = sectionTitleForKey(slice.sectionKey, toc.entries)
      const sectionMeta = { sectionKey: slice.sectionKey, sectionTitle }
      const chunks =
        slice.text.length <= opts.chunkSize
          ? [slice.text]
          : opts.usePygChunking
            ? chunkTextPyG(slice.text, opts.chunkSize, opts.overlapSize)
            : chunkText(slice.text, opts.chunkSize)

      const batchTriples =
        chunks.length === 0
          ? []
          : await runChunksBounded(chunks, (c) => extractWithProgress(c, sectionMeta))

      const mergedSection = mergeTriples(batchTriples)
      groupArrays.push(mergedSection)
      groupArrays.push(sectionEntityLinkTriples(slice.sectionKey, mergedSection))
    }

    return {
      triples: mergeTriples(groupArrays),
      usedToc: true,
      sectionAlignment,
    }
  }

  let hits = findMatchedHeadingSpans(body, toc.entries)
  let slices = hits.length > 0 ? splitBodyIntoSections(body, toc.entries, hits) : []

  if (countSelectedSliceChunks(slices, selectedSet, chunkOpts) === 0) {
    const boundaryHits = findBoundaryHitsForEntries(body, toc.entries)
    if (boundaryHits.length > 0) {
      hits = boundaryHits
      slices = splitBodyIntoSections(body, toc.entries, hits)
    }
  }

  if (slices.length > 0 && countSelectedSliceChunks(slices, selectedSet, chunkOpts) > 0) {
    return extractAlignedSections(slices, true)
  }

  const hasPartialSelection = selectedSet !== null && selectedSet.size > 0
  if (!hasPartialSelection) {
    console.warn(
      '[toc] Section outline detected but no markdown headings matched it; emitting hierarchy triples and running full-body extraction.',
    )
    const bodyText = body.trim() || fullText
    const totalChunks = countChunksForText(bodyText, chunkOpts)
    opts.onProgress?.({ completedChunks: 0, totalChunks })
    const bodyTriples = await extractWholeDocument(bodyText, opts, { completed: 0, total: totalChunks })
    return {
      triples: mergeTriples([[...structural, ...bodyTriples]]),
      usedToc: true,
      sectionAlignment: false,
    }
  }

  console.warn(
    '[toc] Section outline detected but body headings did not align with selected sections; ' +
      'only structural has_subsection triples were stored.',
  )
  return {
    triples: structural,
    usedToc: true,
    sectionAlignment: false,
  }
}
