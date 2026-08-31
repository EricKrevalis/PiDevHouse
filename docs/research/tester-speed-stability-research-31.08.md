# Tester Speed & Stability Research (31.08)

Follow-up to experiment-6-findings-31.08.md: the tester consumed 78% of run wall (1004 s generation + 992 s TTFT), triggered 7 compactions, hit the 32k output cap once, and flailed ~19 min on a build/serve detour. This doc traces each cause to primary sources: the pi-* packages actually installed (`@earendil-works/pi-{coding-agent,agent-core,ai}` 0.84.4 in node_modules) and llama.cpp/Qwen official docs. Two research passes: local code (file:line) and serving-level (URLs).

## 1. Why the tester is slow: confirmed chain

| Cause | Primary-source evidence |
| --- | --- |
| Compaction threshold is 49k of the 64k window | `DEFAULT_COMPACTION_SETTINGS = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }`; `shouldCompact = contextTokens > contextWindow - reserveTokens` (pi-coding-agent/dist/core/compaction/compaction.js:74–78). With `contextWindow: 65_536` (llamaProvider.model.ts:40) → compacts at 49,152. Checked before *every* assistant response (agent-session.js:275–289). |
| Compaction invalidates the whole prefix cache | Post-compaction context = system prompt + brand-new summary message + kept tail (session-manager.js:199–227); everything before the summary is new text. Upstream confirms the mechanism: history mutation "moves the common-prefix point backwards from the tail into the middle" → re-prefill from there (llama.cpp #21681); on Qwen-class hybrid (DeltaNet) architectures a rewritten prefix can force *full* re-prefill via checkpoint invalidation (#20225, #21831). This is the 100–125 s TTFT spikes after each of the 7 compactions. |
| What actually fills 44k of context: stale tool results | System prompt is ~25 tokens (custom prompt passed verbatim, system-prompt.js:20–44); tool defs ≈3–5k fixed. `trimToolOutputs` (trim.ts:13–29) only caps *new* results at 12k chars at execution time and never revisits old ones. A 28-min session of whole-file reads + browser snapshots + bash output crosses 49k — that's the compaction trigger. |
| The 32k-cap incident wastes a full 32k generation | On `stopReason: "length"` pi-agent-core executes *no* tool calls from that message and fails each with "…hit the output token limit…" (agent-loop.js:261–281, `terminate: false` → in-turn recovery exists). A length stop is not retryable (agent-session.js:2241–2246) and not "recoverable" when output == cap (pi-ai overflow.js:163–165). The lost turn is the ~1000 s generation itself; the truncated call + error result stay in history, so a nudge can reference them. |
| Prefill itself is slow on this hardware/model | 27k–28k-token contexts prefill in 80–125 s ≈ 230–340 tok/s. MTP is decode-only ("speculative decoding … drafts tokens during decode/verification"; prefill unaffected) — it cannot help TTFT. Relevant llama.cpp knobs: `-ub/-b` (ubatch size) for prefill throughput; `timings.prompt_ms` / `cache_n` in every response measure it exactly (server README). |

## 1b. REANALYSIS after scripts/serve-qwen3.8.sh (31.08, live-server verified)

`scripts/serve-qwen3.8.sh` (commit 99472db, added after the research above) runs: `-c 65536 -np 2 -fa on -ctk/ctv q8_0 --cache-ram 16384 --cache-reuse 256 --spec-type draft-mtp`, 127.0.0.1-only, warmup call. Most of §2's server recommendations are **already implemented** (`--cache-ram`, `--cache-reuse`; MTP on). Live query of the running server (`GET /slots`) confirms: **two slots, `n_ctx: 32768` each**.

This exposes a client/server contract break that supersedes §1's compaction analysis:

- Client declares `contextWindow: 65_536` and `maxTokens: 32_768` **per request** (llamaProvider.model.ts:40-41), but each slot holds 32,768 total. The script comment ("CONTEXT_LENGTH … must match contextWindow") matched the *total*; pi uses contextWindow as the *per-request* budget.
- The 49,152 threshold-compaction point (§1 row 1) is **16k above the slot ceiling** — threshold compaction can never fire. Instead, every tester call with a prompt near 32k got its `n_predict` clamped by the server → `length` stop with output ≪ 32,768 → `isRecoverableLength(assistantMessage, model.maxTokens)` is true (pi-ai overflow.js: `output < desiredMaxOutput`) → agent-session.js:1653-1659 runs `_runAutoCompaction("overflow", …)` → history rewrite → full re-prefill.
- This single mechanism explains all three tester symptoms at once: the 7 compactions (context regrows past ~30k, clamped stop, compact, repeat — 34 calls), the five 99–125 s TTFT spikes (full re-prefill after each rewrite), and the truncation incident (clamped output cut the giant bash call's args; pi reports it as "hit the output token limit").
- Max observed prompt 28,890 tokens is exactly what a 32k slot permits — the ceiling was hit repeatedly, invisibly.

Corrected server/client recommendations (replace §3 server rows):

| # | Change | Effect | Risk |
| --- | --- | --- | --- |
| 6′ | **Align the window contract.** Either server-only: `NUM_PARALLEL=1` → one 64k slot matching the client's declared 65,536 (agent handoffs then cost a `--cache-ram` restore — the script's own eval measured ~2 s for a 22 k session, vs 30 s+ cold prefill); or client-only: `contextWindow: 32_768` + `compaction: { reserveTokens: 4096, keepRecentTokens: 12000 }` (threshold ~28.7k, before the clamp) + `maxTokens: 16_384` (llamaProvider.model.ts:40-41, agent.model.ts:99-101). Server-only is a one-env-var change. | Removes the clamp → recoverable-length → compaction loop entirely; the 7 re-prefills and the truncation incident disappear | `-np 1`: agents thrash one slot — but `--cache-ram` already handles that at ~2 s/handoff. Client-only: 3 coordinated edits |
| 7′ | **Preflight must check per-slot, not total**: require `min(n_ctx_slot) ≥ contextWindow` (llamaProvider.model.ts:61-78 currently only sums). The live `/slots` response has `n_ctx` per slot. | Would have caught this mismatch before the run | None |
| 8′ | `maxTokens: 32_768` is incoherent in any slot ≤ 32k (output alone can consume the whole window). Drop to 16,384 — observed max output across exps 4–6 is 4,650. | Kills the remaining length-stop surface; raises the recoverable-length bar | None observed |
| 9′ | Keep §2 items 6–8 (pinning, `--cache-ram`, checkpoint recipe) only as *second-order* tuning after the contract fix; `--cache-reuse 256` is already live. | — | — |

§2's `-np 4`-slots-per-agent recommendation (row 6) is retracted: with total `-c` split across slots, more slots = smaller per-slot windows = earlier clamping. With `--cache-ram` on, fewer/wider slots plus RAM-restore handoffs is the correct topology.

## 2. Server-side findings (llama.cpp, cited)

- Prefix caching is per-slot and only against that slot's last prompt (`cache_prompt`, server README; ggerganov in #10993: "the caching only works with the last prompt … use slot save/load API for more advanced caching").
- `--parallel N` **splits** the total context: "`-c 1024 -np 2` → 2 slots with 512 each" (#13606); "-np does not make tokens/second faster. It only provides multiple cache slots so that more prefixes can stay hot. This only improves TTFT" (#15530). The repo's preflight (`sum(n_ctx) == 65536`, llamaProvider.model.ts:67–68) already accepts split slots — but per-agent `contextWindow` must then be the per-slot value or requests overflow.
- Slot selection is prompt-similarity + LRU (`--slot-prompt-similarity`, default 0.1), not round-robin; a fourth agent's work evicts the least-recently-used slot. Requests can pin a slot: `id_slot` request field (server README).
- Slot save/restore: `POST /slots/{id}?action=save|restore` with `--slot-save-path`; restore is memcpy-class (`restore_ms: 0.739` for 72 tokens in #13606).
- In-RAM prompt cache: `--cache-ram N` (PR #16391) + `--cache-idle-slots` (default on): idle agents' KV is serialized to RAM and restored when they return — built for exactly the 4-agent handoff pattern.
- `--cache-reuse N` reclaims matching non-prefix chunks via KV shift; on hybrid models this rides the context-checkpoint path: `--ctx-checkpoints` + `--checkpoint-every-n-tokens` (PR #15293). Verified recipe on Qwen3.6-27B hybrid: `--checkpoint-every-n-tokens 1024 --ctx-checkpoints 256` → "no forcing full prompt re-processing" (#21831; same symptom #20225).
- Qwen3.8 card: keep `preserve_thinking` on (default) — stripping thinking from history shifts the prefix and forces re-prefill; `reasoning_effort` lowering is explicitly warned against for agentic tasks ("can lead to … repeated retries").

Verify-before-applying: the flags above (`--kv-unified`, `--cache-ram`, checkpoints, MTP drafting) require a recent llama.cpp build — confirm against the installed nix build's `llama-server --help` before wiring.

## 3. Recommended changes (ranked)

### Client-side (no server changes; testable next run)

| # | Change | Files | Effect |
| --- | --- | --- | --- |
| 1 | Evict stale tool results per turn via `Agent.transformContext` (first-class hook, agent.d.ts:8,38): keep last N bash/read/browser results verbatim, replace older with `[output elided: tool @ time]`. Deterministic → prefix stays cache-stable between evictions. Prevents crossing 49k → no compaction → no full re-prefill + no 7 summary LLM calls. | trim.ts (extend), agent.model.ts:106 | Attacks 992 s TTFT *and* compaction cost at once |
| 2 | Halve accumulation rate: parameterize the 12k-char trim cap (4–6k for tester), testerPrompt rule against whole-file reads (`sed -n` ranges / grep) | trim.ts, browser.ts:10, testerPrompt.md | Cheapest diff; delays/revents threshold |
| 3 | Tune compaction via the existing `SettingsManager.inMemory({...})`: `compaction: { reserveTokens: 8192, keepRecentTokens: 12000 }` (threshold 49k→57k) or `enabled: false` for the bounded tester session | agent.model.ts:99–101 | One line; belt-and-braces for #1 |
| 4 | Guard the output-cap incident at the source: bash tool rejects commands >~2k chars with an actionable "split into steps" error; testerPrompt "scripts >~50 lines → separate calls" | bash.ts (validate pre-spawn), testerPrompt.md | Removes the 1000 s wasted-generation class; in-turn recovery already works |
| 5 | Targeted nudge on missing result: reference the truncated/failed tool call by name (it is in history with its error result), allow a second nudge round | storyLoop.ts:64–71 | Converts the P0 run-loss into turn-loss |

### Server-side (ops; measure with `timings.prompt_ms`, `cache_n`, `GET /slots`)

| # | Change | Expected effect | Risk |
| --- | --- | --- | --- |
| 6 | One slot per agent, pinned: `--parallel 4` + `id_slot 0..3` per agent + `cache_prompt: true`; size KV pool so each slot holds 64k (`--kv-unified` on recent builds) | Each session keeps its slot warm across handoffs; eliminates cross-agent eviction | ~4× KV memory (~16 GiB f16, ~8 GiB q8_0); preflight must learn per-slot n_ctx |
| 7 | `--cache-ram 8192` (idle-slot prompt cache) | Returning agent restores from RAM in ms instead of re-prefilling | Needs recent build; verify `cache_n > 0` in timings |
| 8 | `--cache-reuse 256 --checkpoint-every-n-tokens 1024 --ctx-checkpoints 256` | Re-prefill after any rewrite shrinks to genuinely new tokens (verified recipe on Qwen-hybrid, #21831) | Watch for "forcing full prompt re-processing" log lines |
| 9 | Raise `-ub`/`-b` (e.g. 2048/4096) for prefill throughput; keep `--context-shift` disabled (default) | Directly cuts the 230–340 tok/s prefill cost for unavoidable cold prefills | Larger compute buffer; check VRAM |

Skipped: custom compaction summarization prompts and per-agent system-prompt shrinking (measured ~25 tokens — irrelevant); stripping thinking from history (Qwen card explicitly recommends preserving it for cache utilization); lowering `reasoning_effort` (official warning: causes retries).

## Sources

- Local: pi-coding-agent 0.84.4 (`dist/core/agent-session.js`, `dist/core/compaction/compaction.js`, `dist/core/session-manager.js`), pi-agent-core (`dist/agent-loop.js:136–139,261–281`, `dist/agent.d.ts:8,38,72–76`), pi-ai (`dist/utils/overflow.js`); repo files cited inline.
- Web: llama.cpp server README (github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md); issues #10993, #13606, #9781, #15530, #16693, #21681, #20225, #21831, #22940, #22942, #15082; PRs #15293, #16391, #23340, #22673; Qwen3.8-27B + Qwen3-8B model cards (huggingface.co/Qwen).
