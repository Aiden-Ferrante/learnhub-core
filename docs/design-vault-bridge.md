# Vault bridge: graduating concepts → Obsidian — design brainstorm (2026-07-08)

**Status: shape proposal for your decision — nothing built.** You asked (2026-07-03) to
brainstorm this before building; here are the forks and a recommendation.

## What graduation means

A concept leaves the drilling loop and becomes a permanent note in the vault's
`Knowledge/` — the hub is the gym, the vault is where knowledge lives. The hub now has
real substance to graduate: per concept there's a signal, verbatim source, deep
explanation, prerequisites, page provenance, figures, and an SM-2 mastery trajectory.

## Fork 1 — what triggers graduation?

- **(a) Automatic on threshold** (mastery ≥ 0.7 or interval ≥ 21d): zero effort, but the
  vault fills with notes you never touched — against the "it should be *mine*" instinct,
  and floods the distill queue.
- **(b) Manual "Graduate" button** on concept detail: deliberate, but writes the hub's
  LLM text into the vault verbatim.
- **(c) Graduation ceremony (recommended):** threshold makes a concept *eligible* (badge:
  "ready to graduate"); graduating it is a final-recall ritual — you write the note **in
  your own words** in a small editor, with the hub's signal/deep-explanation revealed only
  after you draft (same recall→reveal→grade pattern as everything else). Your words are
  the note body; the hub's material lands in a collapsed reference section. This makes
  graduation itself a learning event and every vault note genuinely yours.

## Fork 2 — note shape in the vault

One note per concept, `Knowledge/Concepts/<Concept Name>.md`:

```markdown
---
source: AI Engineering — Chip Huyen
kind: definition
graduated: 2026-07-08
mastery-at-graduation: 0.82
hub: <docId>/<conceptKey>
tags: [concept, source/ai-engineering]
---
<your recall text — the note>

> [!quote]- From the text (p.27)
> <verbatim source sentence>

> [!info]- Hub reference
> <signal + deep explanation>

Prerequisites: [[Tokenization]] · [[Vocabulary]]
```

- `[[prereq]]` links only materialize as links when/if those concepts graduate — until
  then they're the vault's usual "note to write later" markers, which fits your
  self-building-vault plan (graduated concepts ARE the distill step's output).
- Alternative shape (one digest note per chapter) rejected: it recreates the book's
  structure instead of feeding the concept-oriented MOC plan.

## Fork 3 — write path

Non-negotiable given your infra: **through vaultwriter** (:8799 HTTP seam), which already
guarantees new-files-only atomic writes and is the one vault-write contract (Staff,
boox2obsidian, feedwall all use it). New-files-only also answers the update question:
graduation is one-shot; later re-learning produces a new insight note, not an edit.

## Open questions (your call)

1. **Figures**: embed the concept's figure in the note? Needs vaultwriter to accept binary
   attachments (it may not, by design). Options: skip figures; or link back to the hub
   (`http://localhost:3001/...`); or extend vaultwriter with an attachments contract
   (scope creep — decide separately).
2. **Threshold**: mastery ≥ 0.7 (the existing mastered gate) vs interval-based
   (≥ 21 days = survived three review cycles). Interval feels more honest — it measures
   retention, not accuracy-in-a-session.
3. **Where the ceremony lives**: concept detail (natural) vs a weekly "graduation day"
   batch surface (ritual-shaped, pairs with the Sunday review you already do).

## Smallest honest v1

Eligibility badge on concept detail + "Graduate" opening the write-in-your-own-words
editor + vaultwriter POST + a `graduatedAt` field on the concept (so the hub shows an
alumni state and the review queue retires it). One session of work once the forks above
are picked.
