/**
 * Regression tests for the section-attachment bug (2026-06-14):
 *  1) resolveDocumentOutline must prefer the *complete* outline when a leading
 *     TOC is truncated by PDF conversion — otherwise later chapters fall outside
 *     the outline and their content collapses onto an early section.
 *  2) matchHeadingToEntry (via findMatchedHeadingSpans) must NOT collapse a
 *     numbered heading onto a same-titled entry with a different number — that
 *     funnelled every "X.1 Introduction" onto toc:2.1 (70% of all mentions).
 *
 * Self-contained (no DB / no external markdown). Run: pnpm test:toc-regression
 */
import type { TocEntry } from '../utils/toc-processing';
import { resolveDocumentOutline, findMatchedHeadingSpans } from '../utils/toc-processing';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  — ${detail}`}`);
  if (!cond) failed++;
}

// (1) Truncated leading TOC (2 entries) vs full numbered headings (ch 1–4).
const truncatedTocDoc = `# Table of Contents

1.1 Intro
1.2 Methods

# Body

## 1.1 Intro
alpha
## 1.2 Methods
beta
## 2.1 Intro
gamma
## 3.1 Intro
delta
## 4.1 Intro
epsilon`;

const outline = resolveDocumentOutline(truncatedTocDoc);
const keys = outline?.entries.map((e) => e.sectionKey) ?? [];
check(
  'outline override: later chapters survive a truncated TOC',
  keys.includes('toc:3.1') && keys.includes('toc:4.1'),
  `got ${keys.join(', ')}`,
);

// (2) A numbered body heading whose number is absent from the outline must NOT
//     collapse onto a same-titled entry — it should simply not match.
const entries: TocEntry[] = [
  { numberKey: '2.1', title: 'Introduction', sectionKey: 'toc:2.1', listDepth: 0 },
];
const body = `## 2.1 Introduction
own content
## 3.1 Introduction
different chapter content
## 4.1 Introduction
yet another chapter`;
const hits = findMatchedHeadingSpans(body, entries);
check(
  'no collapse: only the real 2.1 heading matches toc:2.1',
  hits.length === 1 && hits[0].entry.sectionKey === 'toc:2.1',
  `got ${hits.length} hits -> ${hits.map((h) => h.entry.sectionKey).join(', ')}`,
);

// Control: when the outline DOES contain the number, it still matches by number.
const fullEntries: TocEntry[] = [
  { numberKey: '2.1', title: 'Introduction', sectionKey: 'toc:2.1', listDepth: 0 },
  { numberKey: '3.1', title: 'Introduction', sectionKey: 'toc:3.1', listDepth: 0 },
];
const hits2 = findMatchedHeadingSpans(body, fullEntries);
const keys2 = hits2.map((h) => h.entry.sectionKey);
check(
  'control: 3.1 matches toc:3.1 when present (not toc:2.1)',
  keys2.includes('toc:3.1') && keys2.filter((k) => k === 'toc:2.1').length === 1,
  `got ${keys2.join(', ')}`,
);

console.log(`\n${failed === 0 ? 'all passed' : `${failed} failed`}`);
process.exit(failed === 0 ? 0 : 1);
