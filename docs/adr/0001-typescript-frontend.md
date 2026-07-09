# ADR 0001: TypeScript stays — the frontend language question, settled

Date: 2026-07-09
Status: accepted

## Context

The frontend language (TypeScript, Next.js) was inherited from NVIDIA's
dgx-spark-playbooks, never deliberately chosen. Question raised while
standardizing the fleet: is TypeScript the right language for this codebase,
given the owner is Python-first?

Facts at decision time: 236 TS/TSX files, ~37.4k lines, `"strict": true`,
Next.js 15 / React 19 / TS 5. The frontend is the majority of the codebase
(Python services: ~14k lines). Every shipped feature (Deep Chapter, Process
tab, concept quiz UI, Learn front door) was built in it, predominantly by
coding agents.

## Decision

**Keep TypeScript, strict mode, and lean into it.** Three reasons:

1. **Strict types are the best guardrail for agent-written code.** Most of
   this frontend is authored by coding agents; the compiler catches wrong prop
   names, missing fields, and shape drift *before runtime* — exactly the class
   of error agents introduce. Removing TS would remove the cheapest reviewer
   in the loop.
2. **The API boundary is where this app breaks.** Typed response interfaces
   between the Python services and the UI turn silent contract drift into
   compile errors.
3. **Economics.** Rewriting 37k working lines into JS (or a Python-served UI)
   is months of motion for zero user-visible gain — the definition of
   invented work.

The Python-first friction is real but is addressed by *role*, not language:
agents author, the owner reads and reviews. Reading TS is a small skill;
authoring it fluently is not required.

Rejected: migrate to plain JSX (loses the agent guardrail, huge cost);
Python-served UI e.g. htmx (this UI is far too interactive); "loosen strict"
(strict is where the value lives).

## Consequences

- Fleet policy signal: language choices follow *who authors the code*. Where
  agents author at scale, strict typing is a feature, not a tax.
- New frontend work here continues in TS; no parallel JS creep.
- Small repos elsewhere in the fleet (e.g. shipyard's ~250-line UI) may still
  reasonably choose JSX — this ADR is about learn-hub's scale, not dogma.
