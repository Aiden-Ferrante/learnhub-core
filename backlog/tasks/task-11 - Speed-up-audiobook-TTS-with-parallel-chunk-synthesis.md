---
id: TASK-11
title: Speed up audiobook TTS with parallel chunk synthesis
status: Done
assignee:
  - '@claude'
created_date: '2026-07-18 01:16'
updated_date: '2026-07-18 01:52'
labels: []
dependencies: []
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Audiobook narration synthesizes chunks strictly sequentially through Orpheus via the compose Ollama, which caps generation at ~75 tok/s (~0.9x real-time) while the GPU sits at ~50% SM. Batched decoding is nearly free on a bandwidth-bound workload, so raising OLLAMA_NUM_PARALLEL to 2 and synthesizing 2 chunks concurrently should give ~1.7-2x audiobook throughput. The old NUM_PARALLEL=4 crash was 4 x million-token contexts; the 16K context cap (already in place) makes 2 slots safe. One-narration-at-a-time job gate stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ollama-compose runs with OLLAMA_NUM_PARALLEL=2 and the compose comment explains why 2 is safe now
- [x] #2 make_audiobook synthesizes missing chunks with 2 concurrent workers, MP3/timeline output identical in order and format
- [x] #3 checkpoint/resume and progress reporting still work under concurrency
- [x] #4 verified live: two llama-server slots active during an audiobook job and generation faster than the ~75 tok/s single-stream baseline
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. compose: OLLAMA_NUM_PARALLEL 1->2, rewrite the safety comment (16K cap + q8_0 KV makes 2 slots a few-GB overhead, old crash was 4 x 1M ctx)
2. audiobook.py: split synthesis into a parallel fill phase (ThreadPoolExecutor, AUDIOBOOK_TTS_WORKERS env default 2, checkpoint each chunk, lock-guarded progress counter) + the existing sequential assembly loop (loads checkpoints in order; timeline/MP3 logic unchanged). _TTS_GATE stays.
3. docker compose up -d --build learn + recreate ollama (running audiobook job is safe: ledger requeues restart-orphaned jobs, chunks are checkpointed)
4. verify live: -np 2 on the orpheus llama-server, two active slots, aggregate tok/s vs 75 baseline
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Compose half done: OLLAMA_NUM_PARALLEL=2 + rewritten safety comment in deploy/compose/docker-compose.yml (not yet applied — container recreate deferred so we only interrupt the running narration once). Code half BLOCKED: a concurrent session is mid-rewrite of make_audiobook (TASK-10 raw-text-only strip-down, working tree dirty as of 01:16 UTC). Monitor armed to resume when TASK-10 commits or flips Done; the concurrency change will be implemented on top of the new single-source make_audiobook.

Verification: orpheus llama-server running with -np 2; ollama logs show slot id 0 and id 1 decoding concurrently at ~65 tok/s each (~130 tok/s aggregate vs 75 tok/s single-stream = 1.73x). Narration toc:1 (139 chunks) survived the mid-job container restart (ledger requeue + chunk checkpoints), resumed, completed done=139/139 with no error; MP3 (10.4MB) + exact timeline written, 139 chunks, playback times strictly monotonic (order preserved under concurrency). test_audiobook.py passes in the new image. NOTE: the compose NUM_PARALLEL=2 edit + this task file were swept into commit e6b70bb by the concurrent TASK-10 session; only audiobook.py is in this task's own commit.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Audiobook TTS now synthesizes chunks 2-at-a-time (ThreadPoolExecutor, AUDIOBOOK_TTS_WORKERS default 2) against OLLAMA_NUM_PARALLEL=2, with a parallel fill phase (checkpoint per chunk, lock-guarded progress) and a sequential assembly phase that preserves narration order and the exact timeline format. Verified live: two active llama-server slots, ~1.73x aggregate throughput (130 vs 75 tok/s), a real 139-chunk narration completed through a mid-job restart with correct MP3+timeline output.
<!-- SECTION:FINAL_SUMMARY:END -->
