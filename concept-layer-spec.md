# Concept Layer — implementation spec

Status: draft for review · Date: 2026-06-14
Owner: (you) · Scope: txt2kg Learn service + frontend

A two-axis knowledge model for the txt2kg learning hub. Adds a canonical **Concept**
layer (the "raw meat" of a learnable thing, tracked across all sources/domains) on
top of the existing provenance + triple store, and re-points mastery and study at it.

---

## 1. Goals & principles

**Goal.** Separate *where knowledge lives* (provenance: source → section → chunk) from
*what it is* (knowledge: domain → topic → concept → proposition). Make the **Concept**
a cross-document anchor so the same idea ("conditional independence") accrues mastery
no matter which book/course/section it appears in.

**Borrowed vocabulary** (don't reinvent):
- **Knowledge Component (KC)** — Koedinger, Corbett & Perfetti (KLI framework): the
  atomic learnable unit. Our `Concept` + `Proposition` rungs.
- **SKOS** (W3C) — `Concept` with `broader`/`narrower`/`related`. Our knowledge graph.
- **Knowledge Space Theory** (Doignon & Falmagne) — prerequisite partial order (DAG).
- **Q-matrix** (Tatsuoka) — which card tests which KC.

**Principles.**
1. **Non-destructive overlay.** `entities` and `relationships` are never mutated;
   concepts are an additive layer. A bad merge is reversible.
2. **Idempotent / re-runnable.** Resolution can run repeatedly and incrementally as new
   documents arrive.
3. **Keyless / local.** Reuse the GPU `sentence-transformers` service for embeddings and
   Ollama for the rare LLM-verify call. No cloud keys.
4. **Incremental delivery.** Each phase ships and verifies on its own.
5. **Multi-tenant aware.** Honor the existing `X-User-Db` per-request DB pattern in the
   Learn service.

---

## 2. Data model (ArangoDB)

### Existing (unchanged)
- `entities` (vertex): `{ _key: md5(lower(name))[:16], name, docIds[] }` — **proto-concepts**.
- `relationships` (edge): `{ _from, _to, type, docIds[] }` — content triples (**propositions**) + structural (`has_subsection`, `section_mentions`).
- `documents`, `section_content` (provenance: Source, Section/Chunk), `processed_documents`, `study_events`.

### New — knowledge axis

`concepts` (vertex)
```jsonc
{
  "_key": "<md5(normalizedKey)[:16]>",
  "label": "conditional independence",      // canonical display name
  "normalizedKey": "conditional independence",
  "aliases": ["cond. indep.", "conditionally independent"], // merged surface forms
  "entityCount": 3,                          // # surface forms in the cluster
  "docIds": ["<docId>", ...],                // union of sources mentioning it
  "topicKey": null,                          // → topics (Phase 3)
  "domainKey": null,                         // → domains (Phase 3)
  "definition": null,                        // optional gloss (Phase 4)
  "resolutionMethod": "embed-cluster",       // embed-cluster | normalize | llm
  "confidence": 0.88,                        // min pairwise cohesion in the cluster
  "createdAt": 0, "updatedAt": 0
}
```

`entity_concept` (edge) — surface form → canonical concept (each entity → exactly one concept)
```jsonc
{ "_from": "entities/<k>", "_to": "concepts/<k>", "similarity": 0.91, "method": "embed" }
```

`concept_edges` (edge, Phase 3) — SKOS/KST relations
```jsonc
{ "_from": "concepts/a", "_to": "concepts/b",
  "type": "prerequisite|broader|narrower|related", "weight": 0.7, "source": "cooccurrence|llm" }
```

`topics`, `domains` (vertex, Phase 3) — may start as fields on `concepts`, promote later.
```jsonc
// topics:  { _key, label, domainKey, conceptCount }
// domains: { _key, label, docIds[] }
```

### New — study artifacts (Phase 4)
`study_cards` (document)
```jsonc
{
  "_key": "<uuid>",
  "conceptKey": "<concepts/_key>",          // primary KC tested
  "type": "qa|cloze|mcq",
  "stem": "...", "answer": "...", "distractors": ["...","...","..."], "cloze": null,
  "sourceTripleIds": ["<triple_id>"],       // provenance: propositions used
  "sourceSectionKey": "toc:1.1.2", "docId": "<docId>",
  "generatedBy": "gemma4:latest", "verified": true, "createdAt": 0
}
```

### Extended — learner state
`study_events`: add `concept_key` (resolved at answer time from the tested triple's
endpoints). Existing `section_key`, `triple_id`, `correct`, `ts`, `doc` stay.

### Indexes
- `entity_concept`: persistent on `_from` and `_to`.
- `concepts`: persistent on `normalizedKey` (dedupe), `topicKey`, `domainKey`.
- `concept_edges`: edge index (default) + persistent on `type`.
- `study_cards`: persistent on `conceptKey`, `sourceSectionKey`.
- `study_events`: persistent on `concept_key` (new).

---

## 3. Phase 1 — Concept layer (the keystone)

New module `app/concepts.py` (Learn service). Pure-ish: clustering math is unit-testable
without a DB; only the embed call and writes touch I/O.

### Pipeline `resolve_concepts(db, *, threshold=0.85, llm_verify=True)`
1. **Fetch** entities with mention frequency (out+in degree over content `relationships`).
2. **Normalize** `norm(name)` = lower · strip punctuation · singularize · collapse ws.
   - Exact `norm` matches → free pre-merge.
   - **Exclude** single-char and pure-number names from cross-doc clustering
     (`X`, `Y`, `U`, `1.5`) — they're polysemous; keep per-entity or per-section. (Risk R2.)
3. **Embed** one representative name per pre-cluster via `POST sentence-transformers /embeddings`
   (all-MiniLM, 384-dim, GPU). Batch ~256.
4. **Cluster** — cosine k-NN graph, keep edges ≥ `threshold`, take connected components.
   - Cap component size; large/low-cohesion components are flagged for `llm_verify` or split.
5. **Canonical label** = highest-frequency surface form in the component (tie → shortest
   non-abbreviation).
6. **LLM-verify (borderline only)** — Ollama prompt: "Are these the same concept? Give the
   canonical name, or split into groups." Applied only to flagged components to bound cost.
7. **Write** (idempotent upsert): `concepts` + `entity_concept` edges; backfill `docIds`,
   `entityCount`, `confidence`.

**Incremental mode.** On a later run, embed only *new* entities and match each to the
nearest existing concept (≥ threshold) or spin up a new concept — avoids full recluster.

### Endpoints (Learn service)
- `POST /api/concepts/resolve` → run the batch job; returns `{entities, concepts, reductionRatio, flagged, seconds}`.
- `GET  /api/concepts?doc=&q=&limit=` → list (label, entityCount, docIds, mastery in P2).
- `GET  /api/concept/{key}` → detail: aliases, propositions (triples whose endpoints resolve here), mentioning sections, sources.

### Helpers
- `concept_for_entity(name) -> conceptKey` (resolve a surface form via `entity_concept`).
- `propositions_for_concept(key)` — `relationships` where `_from`/`_to` resolves to `key`.

### Verify (Phase 1)
- Reduction ratio sane (e.g. 15,445 entities → ~8–11k concepts; report it, don't assume).
- Spot-check the 30 largest merges by hand — no wrong merges; no single-letter over-merge.
- Existing deck/quiz/Socratic unaffected (concepts are additive).
- Re-running `/resolve` is a no-op on counts (idempotent).

---

## 4. Phase 2 — Concept-level mastery

### Event tagging
In `record_quiz_event` (study_routes/mastery): resolve the tested triple's subject/object
→ `concept_key`(s); store on the `study_events` row. (A triple maps to ≤2 concepts; pick the
one the question targets — usually the answer entity.)

### Mastery math (`mastery.py`)
Add `compute_concept_mastery(doc=None)` mirroring the section model:
- **coverage** = distinct quizzed propositions about the concept / total propositions about it.
- **accuracy** = Beta(α,β) posterior mean over the concept's quiz events.
- **decay** = `exp(-Δdays / τ)` (unchanged).
- Cross-source aggregation is automatic: events from different docs share `concept_key`.

Section mastery stays (provenance view); a concept view is added to the hub. Optionally
re-derive section mastery from the concepts it mentions later.

### Verify (Phase 2)
Quiz a concept via a section in doc A, then a different section/doc B → the concept's
mastery reflects **both** (the cross-domain payoff, demonstrated).

---

## 5. Phase 3 — Concept relations + Topic/Domain

### `concept_edges`
- **related**: co-occurrence within a section/proposition, weighted by PMI.
- **prerequisite**: directional — earlier-in-provenance concept that co-occurs with a
  later one → candidate prereq; confirm borderline with Ollama ("is A needed to understand B?").
- **broader/narrower**: lift from `has_subsection` structure or LLM.

### Topic / Domain
- **topic**: cluster concepts (embeddings) → topics; or map a concept to its dominant
  section's chapter. Set `concepts.topicKey`.
- **domain**: one Ollama call per document ("what field is this?") → `domains` + `domainKey`.

### Payoff
"What to study next": topological order over the prerequisite DAG, gated by current
mastery (study a concept once its prereqs are mastered).

### Verify (Phase 3)
A prereq path renders for a chosen concept; topics group sensibly; domain label correct.

---

## 6. Phase 4 — Distill → Cards (ties to the learning-science research)

New module `app/distill.py`. Per concept (or per section):
1. Gather the concept's propositions + the source chunk/section markdown.
2. Ollama (JSON-schema-constrained output) generates N **atomic** cards
   (`{type, stem, answer, distractors[3], cloze, sourceTripleIds}`); bias MCQ distractors
   toward graph-adjacent concepts (KGGDG — harder, plausible-but-wrong).
3. **Faithfulness gate** — a second cheap Ollama call: "Is `answer` supported by the text?
   Are distractors clearly wrong?" Drop failures.
4. Write `study_cards`.

Study modes serve **cards**; the mastery coverage denominator becomes cards, not raw
triples → the noise-pruning problem dissolves (a good generator never emits
`Meek, C. | page number | 51`).

### Verify (Phase 4)
A/B distilled cards vs raw-triple cards using the existing mastery metric as the scoreboard.

---

## 7. Sequencing, rebuild & test notes

- All backend work is in the **Learn service** (Python). Code is COPIED into the image —
  each change needs `docker compose build learn && up -d learn` from `assets/deploy/compose`.
  Recreating `learn` does **not** touch Ollama.
- Clustering/mastery math goes in **pure functions** with `tests/` (no DB), matching the
  existing test style (`test_arango_tree.py`, `test_mastery.py`).
- Reuse the in-container `node + global fetch` REST trick (or Python `urllib`) for live DB
  verification without the root password on the host.
- `sentence-transformers` must be running (the `vector-search` compose profile) and on GPU.

---

## 8. Open questions & risks

- **R1 — merge threshold.** Precision/recall of clustering needs a labeled spot-check; start
  conservative (≥0.85) and tune. False merges are the main quality risk.
- **R2 — notation/polysemy.** Single letters (`X`,`Y`) and generic words (`model`,`variable`)
  mean different things per context; exclude single-letters from cross-doc merge; consider
  domain-scoping concepts so "model" in stats ≠ "model" in logic.
- **R3 — incremental resolution.** Re-running on every new doc must match-to-existing, not
  full-recluster, to stay fast and stable.
- **R4 — mastery backfill.** Existing `study_events` lack `concept_key`; backfill by resolving
  their `triple_id`, or accept they only count at section level until re-answered.
- **R5 — performance.** 15k embeddings is seconds on MiniLM/GPU; clustering 15k is fine.
  Watch component-size blow-ups at low thresholds.

---

## 9. Decisions locked (2026-06-14)
- Spec all four phases before coding. ✓
- Concept resolution: **cross-document, conservative** from the start. ✓
- Method: **MiniLM embeddings (GPU) + Ollama verify on borderline only**. ✓

## 10. Open decisions (for you)
- Concept `_key` strategy: hash of canonical label vs stable UUID (re-canonicalization churn).
- Do `topic`/`domain` start as fields on `concepts` or as their own collections?
- Phase 4 card storage: regenerate-on-demand vs persist `study_cards` (spec assumes persist).
- Whether to persist **Chunks** as first-class (currently sections approximate them).
