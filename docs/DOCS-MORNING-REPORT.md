# Docs-stack kickoff — morning report (run 2026-07-09, ~01:00–02:00 EDT)

Ran ahead of the 4:35 AM schedule in the live session (the scheduled task has been
disabled — this run replaces it). Non-destructive: no commits, no deletions, vault
untouched. Your parallel session's uncommitted WIP (machine strip, system routes,
queue cancel) was left exactly as found.

## Phase 0 — Preflight ✅
- **Ollama on GPU**: warm-up load of nemotron-3-nano:30b → **100% GPU** (yesterday's
  CPU-fallback fix is holding). Cold load from disk ≈ 39s.
- **Learn Hub queue**: idle.
- **Repo**: substantial uncommitted WIP from your other session (noted, untouched).
  Branch still has 9+ unpushed commits — push via GitHub Desktop.

## Phase 1 — Census (report-only) ✅
- **scc**: 384 files / 66,044 lines vs 2026-06-29 baseline 429 / 67,462 →
  **−45 files, −1,418 lines** despite the week's features. Purges are winning.
- **vulture (backend, ≥80%)**: 3 findings, all unused params in `lc_vectorstore.py`
  (file itself is live via semantic_search). Backend is clean.
- **Deletion candidates**: none worth your time this pass. Next census should target
  the FRONTEND (37k TS lines, 2.2× the Python) with `npx knip` / ts-prune.

## Phase 2 — OpenWiki experiment (local Ollama) ✅ ran, with caveats
- v0.0.4, keyless recipe (`openai-compatible` → localhost:11434, nemotron-3-nano:30b).
- **First run failed instantly** ("400 invalid message format") — transient; probes
  showed Ollama's OpenAI shim accepts every standard shape (plain/blocks/tools/
  responses-API), and the identical rerun succeeded. Likely a race with the model
  unloading. Retry-on-first-call is the workaround.
- **Second run completed** (~15 min, exit 0). Logs: /tmp/openwiki-run.log,
  /tmp/openwiki-debug.log.
- **Output is thin**: 4 files / 28K total (`quickstart.md`, `quickstart_extended.md`,
  `architecture/system-overview.md`, and an **empty** `overview.md` the agent claimed
  it had "successfully edited").
- **It never added the CLAUDE.md/AGENTS.md pointer** — the advertised agent-integration
  step didn't happen.

## Phase 3 — Quality audit ❌ verdict: reject-for-local-model (for now)
Fact-check of the generated pages against the code:

Accurate: real file names it clearly discovered (build_queue.py, arango_content.py,
deep-chapter.tsx, audiobook.py, read-along.ts…), the broad ingestion→processing→
frontend shape, ArangoDB/FastAPI/Docker Compose.

Fabrications (each verified false):
1. "Kubernetes (future)" / "K8s manifests" — no K8s anywhere in the repo.
2. Frontend "served via Vite" — it's Next.js (`next dev` in package.json).
3. "NVIDIA TTS models" — it's Orpheus 3B via Ollama + SNAC decode.
4. "WebSocket / SSE endpoints push real-time updates" — none exist; the UI polls.
5. Quickstart's `./scripts/setup.sh` — file doesn't exist; `docker compose up
   services/learn` and `npm start --prefix assets/frontend` are both wrong invocations.
6. Components placed under `assets/frontend/app/learn/*` — they live in
   `components/learn/`.
7. Six "deeper dive" pages are linked (`/openwiki/pipelines/…`, `/frontend/…`,
   `/audio-tts/…`, `/knowledge-graph/…`, `/deployment/…`, `/testing/…`) — none exist.
8. `concept_extract.py` — actual name is `concepts_extract.py`.

**Verdict:** the plumbing works (local model CAN drive the agent), but at
v0.0.4 + a local 30B the wiki is shallow, materially hallucinated, self-misreporting,
and skipped its own integration step. Not adoptable as the documentation standard in
this configuration. This is the clean negative result the experiment was designed to
produce — no cloud fallback was attempted, per your keyless constraint.

## Recommendations
1. **Don't standardize on OpenWiki yet.** Recheck in ~a month: it's weeks old, and the
   gap is depth/faithfulness at this model tier, not the concept.
2. If you want it sooner, the honest options are: a stronger local tool-calling model
   when one lands on the Spark, or a one-time cloud-model run (your call — it breaks
   keyless, but wiki generation is a one-shot, low-sensitivity workload).
3. `openwiki/` is left in the repo UNCOMMITTED for your inspection; delete it freely
   (`git clean` won't touch anything else) or keep the two quickstart pages as seeds.
4. Today's cleanup session: push the branch, decide the June cleanup branch merge,
   frontend-focused census if you want more dead code, and write today's vault notes
   by the two-layer rule (decisions/why → vault; current-behavior → wiki-layer only,
   which for now means the repo's docs/ + future wiki).
