# Cross-book concept index — design note (2026-07-08)

**Status: decision needed before building.** The naive v1 was measured against live data
and would render nothing; the real version is a semantic-matching pipeline worth shaping
deliberately.

## The finding that killed the naive v1

Grouping all 435 concepts across the 5 processed books by name:

- **Exact match (lowercased/trimmed): 0 names appear in more than one book.**
- **Normalized match (punctuation stripped, cheap singularization): still 0.**

Two reasons. First, the books genuinely span different vocabularies (AI engineering,
data systems, data engineering, computer vision, software design). Second — and more
fixable — coverage is thin: most books have only their first chapter or two extracted
(21–198 concepts each). "Tokenization" can't collide across books when only one book's
tokenization chapter has been processed.

So: an index keyed on name identity ships as an empty feature today. Not worth the code.

## Options

**A. Name identity, built later.** Cheap (one AQL group-by + a "also in <book>" block on
concept detail). Wait until extraction coverage grows, re-run the overlap measurement,
build when it returns real groups. Zero risk, zero value today.

**B. Semantic identity.** Embed each concept's `signal` with the existing
sentence-transformers service (MiniLM, already GPU-enabled, already indexes books for
`semantic_search`). Cross-document k-nearest-neighbors over concept embeddings, similarity
threshold → candidate pairs. This finds *related* concepts ("schema evolution" ↔
"evolvability"), not just same-named ones — which is arguably the more interesting library
feeling anyway.

**C. LLM judge on B's candidates.** gemma4 pass over each candidate pair: "same concept /
related / unrelated" with a one-line why. Precision layer; the same author+critic pattern
that worked for quiz quality. Output persisted as a `concept_links` edge collection
(sameAs vs relatedTo, score, judgedAt) so it's queryable and curatable (delete an edge =
correction, same spirit as concept deletion feeding the taste loop).

## Recommended shape (when you're ready)

B + C as an idempotent batch pass (like quiz prep: background, per-doc, cached), writing
`concept_links`. Surface read-only first:

1. Concept detail: "Related across your library" block (book title + concept + why-line).
2. Review reveal: one-line cross-reference when a strong `sameAs` link exists.
3. Later: interleaved cross-book drilling (a Today session that mixes linked concepts on
   purpose — the real payoff).

## Sequencing

1. Extract more chapters (the "Build tonight" queue is already doing this) — coverage is
   the bottleneck for every variant.
2. Re-run the overlap measurement (one AQL query, saved in this note's history).
3. Prototype B on the existing embeddings service, eyeball ~50 candidate pairs.
4. Decide the C judge prompt + threshold together (you'll have opinions on the
   similarity cutoff — it's a precision/recall dial).

## Measurement query (re-run anytime)

```python
rows = db.aql.execute(
    "FOR c IN concepts COLLECT n = LOWER(TRIM(c.name)) INTO g "
    "RETURN {n, docs: LENGTH(UNIQUE(g[*].c.docId))}")
multi = [r for r in rows if r["docs"] > 1]
```
