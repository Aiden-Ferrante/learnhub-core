/**
 * Lightweight TOC detector regression checks (run via `pnpm test:toc`).
 */
import {
  analyzeDocumentToc,
  buildTocTree,
  collectDescendantKeys,
  countChunksForText,
  detectContentsSection,
  detectOutlineFromHeadingLevels,
  detectTocBlock,
  findMatchedHeadingSpans,
  isAncestorSectionKey,
  isSliceSelected,
  resolveDocumentOutline,
  splitBodyIntoSections,
  TOC_ROOT_KEY,
} from '../utils/toc-processing';

type Fixture = {
  name: string;
  text: string;
  expectSource:
    | 'toc_block'
    | 'contents_section'
    | 'heading_outline'
    | 'heading_levels'
    | 'none';
  minEntries?: number;
  mustIncludeNumberKeys?: string[];
  mustExcludeTitles?: string[];
};

const TEXTBOOK_CONTENTS_SAMPLE = `# Statistical Practice for Data Science

# Contents

Preface vii
1 Useful Preliminaries 1
1.1 Computing with the R Environment . . . . . . . . . . . . . . . . . . . . . . 1
1.1.1 Introduction to R . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 1
1.1.2 Install R and RStudio on your Computer . . . . . . . . . . . . . . . . . 1
1.1.2.1 Recommended Links . . . . . . . . . . . . . . . . . . . . . . . . . . . 2
1.1.2.2 Get Familiar with RStudio . . . . . . . . . . . . . . . . . . . . . . . 2
1.2 Probability Distributions . . . . . . . . . . . . . . . . . . . . . . . . . . . . 15
Exercises . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 29
ix
x Contents
2 Data Visualization 33
2.1 Introduction . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 33
2.2 Data Sets . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 33
3 Two Sample Inference 59
4 Fixed Effects Analysis of Variance Models 93
5 Linear Regression Analysis 123
6 Linear Regression – More Topics 149
7 Generalized Linear Models (GLIM) 181
8 More on GLIM and Related Methods 213
9 Some Extensions to ANOVA Models 239
10 Models for Dependent Data 257
10.1 Introduction . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 257
10.3 Linear Mixed-effects Models for Longitudinal Data . . . . . . . . . . . . . . 258
Bibliography 273
Index 277

# 1 Useful Preliminaries

Chapter body starts here.`;

const FIXTURES: Fixture[] = [
  {
    name: 'numbered TOC block',
    text: `# Table of Contents

1.1 Introduction
1.2 Methods

# Body

## 1.1 Introduction
Content here.`,
    expectSource: 'toc_block',
    minEntries: 2,
  },
  {
    name: 'markdown link TOC',
    text: `# Contents

- [Introduction](#introduction)
- [Methods](#methods)

# Introduction
Text`,
    expectSource: 'toc_block',
    minEntries: 2,
  },
  {
    name: 'dot leader TOC rows',
    text: `Table of Contents

Introduction ................ 1
Probability ................. 15

# Introduction
Body`,
    expectSource: 'toc_block',
    minEntries: 2,
  },
  {
    name: 'textbook Contents section',
    text: TEXTBOOK_CONTENTS_SAMPLE,
    expectSource: 'contents_section',
    minEntries: 20,
    mustIncludeNumberKeys: ['1.1.2.1', '10.3'],
    mustExcludeTitles: ['ix', 'x Contents', 'Contents xi'],
  },
  {
    name: 'unnumbered heading tree',
    text: `# Statistical Practice for Data

## Introduction
Intro text.

## Probability
Prob text.

### Bayes Theorem
Detail.`,
    expectSource: 'heading_levels',
    minEntries: 3,
  },
  {
    name: 'integer chapter headings',
    text: `## 1 Introduction
A

## 2 Inference
B

## 3 Regression
C`,
    expectSource: 'heading_outline',
    minEntries: 3,
  },
  {
    name: 'plain essay negative control',
    text: `This is a short essay without headings or structure.
It should not produce a TOC outline.`,
    expectSource: 'none',
  },
];

let passed = 0;
let failed = 0;

for (const fx of FIXTURES) {
  const analysis = analyzeDocumentToc(fx.text);
  const outline = resolveDocumentOutline(fx.text);
  const okSource = analysis.source === fx.expectSource;
  const okCount =
    fx.expectSource === 'none'
      ? analysis.entryCount === 0
      : (fx.minEntries ?? 2) <= analysis.entryCount;

  let okKeys = true;
  if (fx.mustIncludeNumberKeys?.length) {
    for (const nk of fx.mustIncludeNumberKeys) {
      if (!analysis.entries.some((e) => e.numberKey === nk)) {
        console.error(`✗ ${fx.name}: missing numberKey ${nk}`);
        okKeys = false;
        failed++;
      }
    }
  }

  let okExclude = true;
  if (fx.mustExcludeTitles?.length) {
    for (const bad of fx.mustExcludeTitles) {
      if (analysis.entries.some((e) => e.title.toLowerCase() === bad.toLowerCase())) {
        console.error(`✗ ${fx.name}: should not include title "${bad}"`);
        okExclude = false;
        failed++;
      }
    }
  }

  if (okSource && okCount && okKeys && okExclude) {
    console.log(`✓ ${fx.name} → ${analysis.source} (${analysis.entryCount} entries)`);
    passed++;
  } else if (!okSource || !okCount) {
    console.error(
      `✗ ${fx.name}: expected ${fx.expectSource} with ≥${fx.minEntries ?? 2} entries, got ${analysis.source} (${analysis.entryCount})`,
    );
    failed++;
  }

  if (fx.expectSource === 'heading_levels' && !detectOutlineFromHeadingLevels(fx.text)) {
    console.error(`✗ ${fx.name}: detectOutlineFromHeadingLevels returned null`);
    failed++;
  }
  if (fx.expectSource === 'toc_block' && !detectTocBlock(fx.text)) {
    console.error(`✗ ${fx.name}: detectTocBlock returned null`);
    failed++;
  }
  if (fx.expectSource === 'contents_section' && !detectContentsSection(fx.text)) {
    console.error(`✗ ${fx.name}: detectContentsSection returned null`);
    failed++;
  }
}

// Selection / tree / chunk count helpers
{
  const outline = resolveDocumentOutline(TEXTBOOK_CONTENTS_SAMPLE);
  if (!outline || outline.entries.length < 20) {
    console.error('✗ buildTocTree setup: expected contents_section outline');
    failed++;
  } else {
    const tree = buildTocTree(outline.entries);
    const ch1 = outline.entries.find((e) => e.numberKey === '1');
    const ch1Node = tree.find((n) => n.sectionKey === ch1?.sectionKey);
    if (!ch1Node || ch1Node.children.length === 0) {
      console.error('✗ buildTocTree: chapter 1 should have child sections');
      failed++;
    } else {
      const descendants = collectDescendantKeys(ch1Node);
      if (!descendants.some((k) => k.includes('1.1'))) {
        console.error('✗ collectDescendantKeys: expected 1.1 subtree');
        failed++;
      } else {
        console.log('✓ buildTocTree / collectDescendantKeys');
        passed++;
      }
    }

    // Cycle safety: a stray heading that slugifies to a bare number ("1" -> toc:1)
    // collides with numbered section toc:1 and used to form a cycle that overflowed
    // the stack ("too much recursion") on Preview TOC. Must build, not throw.
    try {
      const cyclic = [
        { numberKey: '1', title: 'Chapter 1', sectionKey: 'toc:1', listDepth: 0 },
        { numberKey: '1.1', title: '1.1 Section', sectionKey: 'toc:1.1', listDepth: 0 },
        { numberKey: null, title: '1', sectionKey: 'toc:1', listDepth: 9 },
      ];
      const tree = buildTocTree(cyclic);
      const keys = tree.flatMap((n) => collectDescendantKeys(n));
      if (tree.length >= 1 && keys.length >= 1) {
        console.log('✓ buildTocTree cycle-safe (no stack overflow)');
        passed++;
      } else {
        console.error('✗ buildTocTree cycle-safe: empty result');
        failed++;
      }
    } catch (e) {
      console.error('✗ buildTocTree cycle-safe: threw', (e as Error).message);
      failed++;
    }
  }

  if (!isSliceSelected('toc:1.1', new Set(['toc:1.1'])) || isSliceSelected('toc:2', new Set(['toc:1.1']))) {
    console.error('✗ isSliceSelected explicit set');
    failed++;
  } else if (!isSliceSelected('toc:1.1', null) || !isSliceSelected(TOC_ROOT_KEY, new Set([TOC_ROOT_KEY]))) {
    console.error('✗ isSliceSelected null/all or root');
    failed++;
  } else if (!isSliceSelected('toc:1.1.1', new Set(['toc:1.1'])) || !isSliceSelected('toc:1', new Set(['toc:1.1.1']))) {
    console.error('✗ isSliceSelected ancestor/descendant');
    failed++;
  } else if (!isAncestorSectionKey('toc:1.1', 'toc:1.1.2')) {
    console.error('✗ isAncestorSectionKey');
    failed++;
  } else {
    console.log('✓ isSliceSelected / isAncestorSectionKey');
    passed++;
  }

  {
    const body = `# 1 Chapter One

Intro paragraph.

## 1.1 First section

Section one body text here.

## 1.2 Second section

Section two body.`;
    const outline = resolveDocumentOutline(body);
    if (!outline) {
      console.error('✗ body heading alignment setup');
      failed++;
    } else {
      const hits = findMatchedHeadingSpans(body.slice(outline.bodyCharStart), outline.entries);
      const slices = splitBodyIntoSections(body.slice(outline.bodyCharStart), outline.entries, hits);
      const s11 = slices.find((s) => s.sectionKey === 'toc:1.1');
      if (!s11?.text.includes('Section one body')) {
        console.error('✗ splitBodyIntoSections: missing section 1.1 body');
        failed++;
      } else if (!isSliceSelected('toc:1.1', new Set(['toc:1.1']))) {
        console.error('✗ selected slice 1.1');
        failed++;
      } else {
        console.log('✓ body section slices align with TOC');
        passed++;
      }
    }
  }

  const longText = 'word '.repeat(600);
  const chunks512 = countChunksForText(longText, {
    chunkSize: 512,
    overlapSize: 0,
    usePygChunking: true,
  });
  if (chunks512 < 2) {
    console.error(`✗ countChunksForText: expected multiple chunks, got ${chunks512}`);
    failed++;
  } else {
    console.log(`✓ countChunksForText (${chunks512} chunks)`);
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
