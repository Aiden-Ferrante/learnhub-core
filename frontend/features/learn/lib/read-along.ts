/** Read-along: map narration chunks onto the rendered prose and highlight what the
 *  audiobook is currently speaking.
 *
 *  Matching problem: narration text is the TTS-cleaned markdown (math/code/tables/citations
 *  stripped, headings turned into "Title."), while the DOM has the full rendered prose plus
 *  injected extras (section numbers, figure captions). Both sides are therefore reduced to a
 *  bare [a-z0-9] stream — insertions on the DOM side (numbers, captions) sit BETWEEN chunks
 *  and are skipped by the sequential search; chunks whose own text was altered by cleaning
 *  (mid-sentence math) simply don't match and are skipped (no highlight beats a wrong one).
 *
 *  Highlighting uses the CSS Custom Highlight API (no DOM mutation — the concept-annotation
 *  layer keeps working underneath). No-ops gracefully where unsupported.
 */

export type StripIndex = {
  /** The root's text content reduced to lowercase [a-z0-9]. */
  stripped: string
  /** For each stripped char: its source text node + offset (parallel arrays). */
  nodes: Text[]
  offsets: number[]
}

/** Reduce a string to the bare comparable stream. */
export function stripText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/** Build the stripped index of an article's text nodes (one pass; ~O(text length)). */
export function buildStripIndex(root: HTMLElement): StripIndex {
  const stripped: string[] = []
  const nodes: Text[] = []
  const offsets: number[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement
      if (!p || p.closest("script,style,noscript")) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let t: Node | null
  while ((t = walker.nextNode())) {
    const text = (t as Text).data
    for (let i = 0; i < text.length; i++) {
      const c = text[i].toLowerCase()
      if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) {
        stripped.push(c)
        nodes.push(t as Text)
        offsets.push(i)
      }
    }
  }
  return { stripped: stripped.join(""), nodes, offsets }
}

export type ChunkSpan = {
  /** Start/end positions in the stripped stream (end exclusive), or null when unmatched. */
  start: number
  end: number
  /** Stripped-offset of each narration word's start within [start, end) + its length —
   *  drives the interpolated word highlight. */
  wordStarts: number[]
  wordLens: number[]
} | null

/** Locate every narration chunk in the article, in order. Sequential forward-only search:
 *  a miss doesn't advance the cursor, so one unmatchable chunk can't derail the rest. */
export function locateChunks(index: StripIndex, chunkTexts: string[]): ChunkSpan[] {
  const spans: ChunkSpan[] = []
  let cursor = 0
  for (const text of chunkTexts) {
    const words = text.split(/\s+/).filter((w) => stripText(w))
    const strippedWords = words.map(stripText)
    const full = strippedWords.join("")
    if (!full) {
      spans.push(null)
      continue
    }
    // Full match first; fall back to a prefix so cleaned-out math mid-chunk still anchors
    // the beginning of the sentence.
    let matched = ""
    let at = -1
    for (const probe of [full, full.slice(0, 80), full.slice(0, 40)]) {
      if (probe.length < 12 && probe !== full) continue // too short to trust as an anchor
      at = index.stripped.indexOf(probe, cursor)
      if (at >= 0) {
        matched = probe
        break
      }
    }
    if (at < 0) {
      spans.push(null)
      continue
    }
    const wordStarts: number[] = []
    const wordLens: number[] = []
    let acc = 0
    for (const w of strippedWords) {
      if (acc >= matched.length) break
      wordStarts.push(acc)
      wordLens.push(Math.min(w.length, matched.length - acc))
      acc += w.length
    }
    spans.push({ start: at, end: at + matched.length, wordStarts, wordLens })
    cursor = at + matched.length
  }
  return spans
}

/** DOM Range over a stripped-stream interval. */
export function rangeFor(index: StripIndex, start: number, end: number): Range | null {
  if (start < 0 || end > index.nodes.length || start >= end) return null
  const range = document.createRange()
  range.setStart(index.nodes[start], index.offsets[start])
  range.setEnd(index.nodes[end - 1], index.offsets[end - 1] + 1)
  return range
}

const supportsHighlights = () =>
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"

/** Set (or clear, with null) a named highlight. */
export function setHighlight(name: string, range: Range | null): void {
  if (!supportsHighlights()) return
  if (range) CSS.highlights.set(name, new Highlight(range))
  else CSS.highlights.delete(name)
}

export function clearReadAlongHighlights(): void {
  if (!supportsHighlights()) return
  CSS.highlights.delete("txt2k-read-chunk")
  CSS.highlights.delete("txt2k-read-word")
}
