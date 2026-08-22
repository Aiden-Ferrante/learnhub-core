# ADR 0002: Kokoro-82M replaces Orpheus for audiobook TTS

Date: 2026-08-22
Status: accepted

## Context

Audiobook generation was too slow to use. Measured on this GB10, warm, end to end:

| configuration | same chapter (DDIA acknowledgments) | realtime factor | 1-hour chapter |
|---|---|---|---|
| Orpheus 3B Q4, 2 Ollama slots × 2 workers (as shipped) | ~282s | 1.13× | ~53 min |
| Orpheus 3B Q4, 8 slots × 8 workers (tuned 2026-08-22) | 132.7s | 2.40× | ~25 min |
| **Kokoro-82M, single stream** | **5.6s** | **50–52×** | **~1.2 min** |

Two measurements decided this, and both contradicted an intuition worth recording.

**The batching lever is real but small, and it is now spent.** Orpheus decode is
memory-bandwidth-bound, so batching amortises the weight read and does help — but
sublinearly, and oversubscription reverses it. Aggregate realtime by slot count, concurrency
matched: 2 → 1.13×, 4 → 1.72×, 8 → 2.40×, and 12 streams against 8 slots fell back to 1.64×.
Per-stream RTF *degrades* as concurrency rises (0.63× → 0.30× from 1 to 8 streams); the
aggregate gain comes only from having many sentences in flight. An independent vLLM-Omni
ablation shows the same curve shape on other silicon, so this is the architecture, not Ollama.

**The cost is structural, not incidental.** Orpheus is a 3B autoregressive LLM emitting 7
discrete audio tokens per frame, so every frame of audio pays a full transformer decode.
SNAC decode is only 7% of wall time — the vocoder was never the problem, and no faster
vocoder or serving stack changes the arithmetic. Concurrency hides latency; it does not
reduce work.

Kokoro is a different shape: 82M parameters, non-autoregressive, no per-frame LLM decode.
It is ~30× smaller, so each second of speech costs ~30× less memory traffic — which is why
it beats a *batched* 3B model by 24× while using **one** stream.

Alternatives considered. Qwen3-TTS (Apache-2.0, Jan 2026) has the strongest published
long-form intelligibility evidence (WER 1.225 en on 200–2000-word passages), but its
throughput claim does not reproduce: the vendor reports RTF 0.288 on unnamed hardware via an
unreleased vLLM build, while an independent RTX 3090 run of the released code measures RTF
0.97 — parity with the Orpheus baseline. It is also architecturally the same class as
Orpheus, so it is not an escape from the problem. The wider field (Piper, F5, XTTS,
Chatterbox, Fish Speech, StyleTTS2, Sesame CSM) produced almost no claims that survived
adversarial verification, so it is **not** the case that Kokoro beat a well-measured field —
it is that Kokoro's own evidence is strong and was then reproduced here.

## Decision

**Adopt Kokoro-82M as the audiobook TTS engine, run in-process, single-stream.**

1. **Single stream, no concurrency.** Measured 50.4× (1 stream), 51.9× (4), 49.0× (8) — flat.
   One stream saturates the GB10. Do not add a worker pool; there is no latency left to hide.
   (A first measurement showing parallelism *hurting* was a harness bug — each worker thread
   built its own `KPipeline`, putting a ~2s model load inside the timed region.)
2. **Revert `OLLAMA_NUM_PARALLEL` to 2.** It was raised to 8 solely for Orpheus batching.
   It applies to every model fleet-wide, costing KV headroom on the 30–50GB models for no
   remaining benefit.
3. **Delete the checkpoint/resume subsystem** rather than fix it. The per-chunk `.npy`
   checkpoints, pinned manifest, work dirs and `interrupted` status exist to protect *hours*
   of GPU time from a crash. A chapter now costs six seconds; re-rendering is cheaper than
   resuming. This also retires audit finding C8 (a dud chunk was saved as a valid zero-length
   checkpoint and never retried, silently dropping a sentence) by deleting the code that had
   the bug.
4. **Keep the `synthesize(text) -> np.ndarray` seam.** It is already the right boundary and
   both engines satisfy it, so the swap does not reach into `make_audiobook`.

Voice: `af_bella` is the only A-graded English voice on the model card and is the default
pick, pending an ear check against `af_heart`, `af_sarah`, `am_michael`, `am_fenrir`,
`bf_emma`, `bm_fable`. **`af_nicole` is excluded on measurement**, not taste: it rendered the
same technical paragraph in 37.4s where the others took 21–27s (it is the breathy 🎧 voice),
which is wrong for hour-long narration.

## Consequences

**Good.** ~24× faster than the tuned pipeline and ~50× faster than as-shipped. Chapters become
interactive rather than a background job, which weakens the case for TTS being queue work at
all. Net deletion of code. Kokoro is Apache-2.0 and fully local, so the keyless constraint
holds. Being a fixed-speaker model, it carries no cross-chunk state — NVIDIA's Interspeech
2026 work documents prosody drift and boundary artifacts from sentence-chunk-and-concatenate,
but only for zero-shot *cloning* models; our chunking design is safe with this class and would
have been a liability with the alternatives.

**Costs and risks.** Quality is the real trade: 82M parameters is "clear and pleasant", not
state-of-the-art expressive, and Orpheus's emotion tags are lost. This was accepted
deliberately — the stated bar is an hour of technical narration, not performance. A new
dependency tree enters the backend (`kokoro`, `misaki`, and a spaCy `en_core_web_sm` model);
verified installing clean on aarch64 with torch 2.13.0+cu130 untouched, which was the risk
most likely to sink this. Kokoro narrates ~10% faster than Orpheus (288.5s vs 318.6s for
identical text), so existing timeline sidecars do not transfer.

**Not established.** No GB10/sm_121 TTS measurements exist anywhere in public sources; every
external number here is a transfer estimate, and the 50× figure above is ours, measured on one
chapter. Long-run robustness over a full book is unproven — per-chunk validation (duration
sanity plus an ASR roundtrip) is recommended by the research independently of model choice and
remains open.
