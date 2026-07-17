# TOC Derive Strategies — Contract Addendum

Addendum to the TOC controller design. Scope: the `derive` stage only — the fallback
strategies that run when a PDF has no usable embedded bookmarks. The controller
(`app/process/content/toc_controller.py`) routes to these; nothing else may call them.

## The contract (the one rule that keeps this clean)

Every strategy is a pure function with the same signature and the same output shape —
**the raw-bookmark shape** that `reader.extract_pdf_outline` already returns:

```python
def derive(ctx: TocDeriveContext) -> list[dict] | None
    # returns [{"level": int>=1, "title": str, "page": int>=1}, ...] in reading order
    # returns None when the strategy cannot produce a credible outline
```

Rationale: whatever a strategy returns flows into the existing
`build_outline_from_bookmarks` → `assign_blocks_to_outline` pipeline exactly as if the
PDF had author bookmarks. Downstream code (canonical keys, reconciliation, tree
building, storage) needs **zero changes** per strategy, ever.

### TocDeriveContext

One small frozen dataclass, assembled by the controller from what `persist_document`
already has in hand:

```python
@dataclass(frozen=True)
class TocDeriveContext:
    pdf_bytes: bytes | None            # for strategies that need fitz (fonts, raw text)
    blocks: list[SectionBlock]         # split markdown sections (order, heading, page spans)
    heading_pages: list[tuple[str, int]]  # (heading text, 1-based page), reading order
    pages: list[tuple[int, str]]       # (1-based page, page markdown)
    page_count: int
```

Strategies must not: touch the DB, import api/conductor/gateways, import each other,
mutate the context, or raise on bad input (return `None` and let the controller log it).

## Layout

```
app/process/content/toc_strategies/
    __init__.py          # exports STRATEGIES: ordered list of (name, fn)
    from_headings.py     # priority 1
    from_contents_pages.py  # priority 2
    from_llm.py          # priority 3 (stub until decision logs justify it)
```

The controller iterates `STRATEGIES` in order, takes the first non-`None` result, and
records per attempt: `"derive/<name>: <n> entries"` or `"derive/<name>: declined (<why>)"`.
Adding a strategy = one new file + one entry in `STRATEGIES`.

## Strategy 1 — from_headings (implement first)

Idea (cf. pdf.tocgen — see License note): infer outline levels from font attributes of
detected headings.

- Inputs: `heading_pages` for text+page; one fitz pass over `pdf_bytes` to recover each
  heading's font size / boldness (match by page + normalized text).
- Cluster heading font sizes (round to 0.5pt); map descending size clusters → levels 1..3.
  Cap at 3 levels; deeper distinctions are noise at this stage.
- Sanity gates before returning (else `None`): ≥ 3 entries; pages non-decreasing;
  entries span ≥ 30% of the page range; no single page contributes > 20% of entries.
- No new dependencies. Target ≤ ~150 lines.

## Strategy 2 — from_contents_pages

Idea (cf. tocPDF): parse the book's printed Contents pages.

- Locate candidate pages: page markdown whose first non-blank line matches
  `^(table of )?contents$` (ci), plus continuation pages while lines keep matching the
  entry pattern.
- Entry pattern: `title  [.·…\s]{3,}  page-number$` (also handle no-leader lines ending
  in a number). Indentation / numbering prefix ("3.2") gives the level.
- Printed-vs-physical page offset: fit a constant offset by locating 2–3 sampled titles
  in `pages` text; apply to all entries. If no consistent offset is found, return the
  printed numbers anyway (reconciliation's ±2-page guard tolerates small drift) but log it.
- Sanity gates: ≥ 5 entries; resolved pages within [1, page_count]; monotonic.

## Strategy 3 — from_llm (stub)

Registered in `STRATEGIES` but returns `None` with reason `"not implemented"`.
Build only if decision logs show real books defeating strategies 1–2. When built: input
is `heading_pages` (+ contents-page text if found), output validated against the same
sanity gates — the LLM proposes, the gates dispose. Uses the existing `gateways/llm`.

## Testing

- Per strategy: table-driven unit tests on synthetic contexts (no PDFs needed for the
  gate logic; tiny fixture PDFs for the fitz font pass).
- One controller-level test per route asserting the decision log names the strategy used.
- Fixture PDFs live under `backend/tests/fixtures/toc/` — one bookmarkless-but-clean,
  one with printed Contents pages, one hopeless (scanned) that must route to `none`.

## Non-goals

- No GROBID / huridocs / layout-ML services (scholarly-paper tooling; heavy; wrong fit).
- No Marker engine integration (that is a converter-level decision, separate discussion).
- No repair of *messy* bookmarks here — derive runs only on `absent` (v1).

## License note

pdf.tocgen is GPLv3: read for the algorithm, do not copy code. tocPDF (MIT) may be read
freely; still prefer reimplementation against our shapes. Both are referenced as prior
art in this doc only.
