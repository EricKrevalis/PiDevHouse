# Model Hosting Findings (31.08)

Consolidates the experiment-3/F06 findings, the hardware audit, and a
llama-server vs Ollama evaluation on the jupyter box (2026-08-31). Decides the
serving stack for `qwen3.8-mtp` (unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S + MTP) and
produces the self-contained host script `~/serve-qwen38.sh` (replaces the old
`~/tailscale.sh`; runnable as `~/serve-qwen38.sh` or `serve-qwen38` via the
symlink in `~/.local/bin`).

## Hardware Audit (jupyter box)

| Fact | Value | Consequence |
| --- | --- | --- |
| GPU | Tesla V100-PCIE 16GB, sm_70, driver 580 / CUDA 13 | 16GB is the hard budget: 11.7GB weights + projector/KV must fit; Ollama's CUDA v13 runner skips sm_70 (falls back to cuda_v12 libs); llama.cpp built from source targets sm_70 natively |
| Model | UD-IQ3_S 12.04GB blob (+0.93GB mmproj projector in the Ollama manifest) | text-only workload does not need the projector; it is pure VRAM overhead under Ollama |
| KV cache | 2 slots × 32k tokens, q8_0 ≈ 4GB | the only config that fits both servers; q4_0 needed for Ollama (see eval) |
| System | 40 cores, 754GB RAM | host-RAM KV/prompt cache (`--cache-ram`, MULTIUSER_CACHE) is effectively free — use it aggressively |
| Network | tailscale userspace networking, already authenticated | serve model on 127.0.0.1 only; expose via `tailscale serve` (fixes the P1 "binds 0.0.0.0" finding) |

## Evaluation: llama-server (llama.cpp b1-f8dbcd6, source build) vs Ollama 0.32.1

Identical workload per server (streaming `/v1/chat/completions`, temp 0):
warmup + 1024-token generation, prefix evals of ~5.6k / ~22.4k / ~16k tokens
each sent twice (repeat = same-prompt cache hit), and an agent-switch pattern
(A 22.4k, B 22.4k, A again — the P0 TTFT scenario from experiment-3).

| Metric | Ollama (65k ctx, np 2, KV q4_0) | llama-server (65k ctx, np 2, KV q8_0) |
| --- | --- | --- |
| Prompt eval (cold) | 585–650 tok/s | 603–696 tok/s |
| Generation | 43–48 tok/s (MTP acc 0.8, mean acc len 2.33) | 40–47 tok/s (MTP acc 0.8, mean acc len 2.33) |
| TTFT 5.6k prompt | 10.9s (repeat: 9.7s — cache **miss**) | 9.8s (repeat: **0.34s**) |
| TTFT 22.4k prompt | 40.3s (repeat: 2.3s) | 38.8s (repeat: **0.50s**) |
| TTFT 16k prompt | 27.6s (repeat: 2.1s) | 26.6s (repeat: **0.42s**) |
| Agent switch A→B→A | 39.7 / 41.0 / **4.1s** | 38.2 / 39.8 / **2.1s** |
| VRAM (idle, loaded) | 14.85GB but **OOM crash with q8_0 KV** (MTP draft buffer spike); forced q4_0 | 15.16GB, q8_0 stable |
| Model (re)load | 28s cold / 9.6s warm | 8s warm from page cache |
| API | native Ollama API (`/api/ps`, `/api/generate`) | OpenAI `/v1` (+`/slots`, `/props`); **no Ollama API** |

### Interpretation

1. **Compute is a wash.** Both stacks are the same llama.cpp core with MTP
   draft decoding; prompt eval and generation speed are within noise. MTP
   works in both (acceptance 0.8, mean accepted length 2.33 ≈ 1.6–1.7× gen
   speedup).
2. **Cache behavior is the P0 battleground and llama-server wins twice.** It
   restores an evicted 22k-token session in ~2s vs Ollama's 4.1s, and same
   slot repeats return in 0.3–0.5s vs Ollama's 2.1–9.7s — including one
   outright miss. `--cache-reuse 256` additionally reuses *partial* prefixes
   (the shared `TEAM_PREFIX` across agents), which Ollama's coarse
   checkpoint/restore does not.
3. **VRAM safety favors llama-server.** Ollama's q8_0 KV runner aborts with
   CUDA OOM during MTP draft processing at 65k × np2; the workaround is q4_0
   KV — exactly the quantization the docs flag as quality-degrading at 30k+
   context. llama-server runs q8_0 stably at 15.16GB.
4. **API compatibility favors Ollama.** `OllamaProvider` preflight
   (`/api/ps`, warm-load `/api/generate`) works unmodified; llama-server 404s
   those routes. Mitigation: a small llama-server fallback in the provider's
   `getLoadedModel` (query `/props` + `/slots`), keeping the Ollama path
   intact.

### Decision

Host with **llama-server** (`~/.local/share/qwen38/bin`, already built with
native sm_70 CUDA + MTP): `-c 65536 -np 2` (2×32k slots matching the
`OLLAMA_CONTEXT_WINDOW`/`contextWindow: 65536` contract), `-fa on`,
`-ctk/-ctv q8_0`, `--cache-ram 16384` (spill evicted agent sessions to the
754GB host RAM), `--cache-reuse 256` (partial-prefix reuse),
`--spec-type draft-mtp --spec-draft-n-max 2`, bound to 127.0.0.1 and exposed
via tailscale serve. Provider preflight gains a llama-server fallback so the
65,536-token context check still guards against config drift.

Ollama remains documented as the fallback host (q4_0 KV, np 2) — it satisfies
the provider unmodified but pays 2–10s extra per cache restore and carries the
q4_0 quality risk.

## Applied This Session

| Fix | Where |
| --- | --- |
| Self-contained host script (tailscale userspace + llama-server + warm-up + tailscale serve) | `~/serve-qwen38.sh` |
| Preflight llama-server fallback (`/slots` + `/props`) when `/api/ps` is absent | `ollamaProvider.model.ts` |
| Eval record (this document) | `docs/research/model-hosting-31.08.md` |

## Remaining

| Priority | Item | Note |
| --- | --- | --- |
| P2 | Strip the 0.93GB mmproj from the Ollama manifest | only relevant if Ollama fallback is ever used; llama-server never loads the projector |
| P2 | Refresh the llama.cpp build against upstream | source tree at `~/.local/share/qwen38/src` pins b1-f8dbcd6 (31.08) |
| P3 | Auto-restart llama-server on crash | a watchdog (systemd user unit or loop in the script) — rig currently relies on manual restart |
