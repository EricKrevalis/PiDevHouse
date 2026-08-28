# Experiment-3 Findings

This document consolidates the findings from the experiment-3 log analysis, the Qwen3.8-27B model research, the source-code review, and the changes applied in this session (2026-08-27/28).

## Experiment-3 Analysis

| Priority | Area | Finding and evidence | Impact |
| --- | --- | --- | --- |
| P0 | Time to first token | TTFT is 353–2088s per run (38% of the 4318s outlier). The reviewer is worst: 67 LLM calls, 1.73M input tokens (65% of the run total), context grown to ~48k/call; reviewer = 60% of baseline-run-1. Agents alternate on one Ollama slot, so llama.cpp's prefix cache is evicted between turns and each agent re-processes its whole context. | The dominant wall-clock cost is re-evaluated prompt, not generation (uniform 38–46 tok/s) or tool execution (2–52s per run across 167–205 calls). |
| P1 | Rework loops | A failed review replays the full developer+reviewer cycle (+1800s in the outlier) and each iteration starts a fresh developer session (storyLoop.ts:81) that rediscovers context. | Runs needing 2–3 iterations pay multiples of the base cost. |
| P1 | Sandbox flailing | Reviewers repeatedly wrote fixtures to `/tmp` (read-only in bwrap): 5–6 failed bash calls × a full generation each, ~15 min in one run. 10 "Tool paths must stay inside" violations across runs. | Dead generations that never advance the story. |
| P1 | Agent lifecycle | 3 `agent_retry` events (reviewer/tester ended without `update_story_status`), costing 152s–229s each. | Retry re-invocations burn full generations. |
| P2 | Browser tooling | 2 `browser open file://…` → "No hostname in URL" failures per experiment; testers fell back to bash. Tester must screenshot every criterion, including pure-logic stories (updateStoryStatus.ts:25-33). | Forced serve/open/snapshot rounds and a flake source (browser fail → run `incomplete`). |
| P2 | Run results | Success 6/8 (exp-3) vs 3/10 (exp-1). Recipe-vault failed both runs (review score 62, then max_iterations). Zero hangs, stalls, degenerate model loops, or JSON parse errors — failures were harness- and serving-level. | The pipeline got more reliable exp-1 → exp-3; remaining failures are not model-degenerate behaviour. |

## Model Research (models/qwen3.8-mtp)

| Priority | Area | Finding and evidence | Impact |
| --- | --- | --- | --- |
| P0 | Output budget | The Modelfile is unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S (12GB, 3-bit Dynamic 3.0) with MTP (`draft_num_predict 2`), 64k ctx. `maxTokens: 8192` is ~16× below Qwen's agentic recommendation (≥131k output; thinking counts against it). | Long thinking truncates mid-tool-call → the `agent_retry`/nudge path seen in logs. |
| P1 | Serving config | Sampling in the Modelfile exactly matches Qwen's thinking-mode recommendation (temp 1.0, top_p 0.95, top_k 20, min_p 0) — no change needed. MTP accelerates generation, not prompt processing, so it does not touch the measured bottleneck. | Confirms generation tuning is done; TTFT must be attacked via context/cache. |
| P2 | Quant quality | UD-IQ3_S held up: zero parse errors, no degenerate loops. The recipe-vault review-score-62 failure is consistent with 3-bit reasoning loss. | Upgrade path if review failures persist: UD-Q3_K_XL (13.1GB, ~1GB step) or UD-Q4_K_XL (17.6GB). |

## Applied This Session

| Fix | Where |
| --- | --- |
| `maxTokens` 8192 → 16384 | ollamaProvider.model.ts:56 |
| Bash default command timeout 300s (model can pass longer) | bash.ts (`DEFAULT_TIMEOUT_SECONDS`) |
| Ollama retry: 2 attempts, 1s base delay | agent.model.ts (`SettingsManager.inMemory` retry) |
| Session creation inside try/finally — browser/server cleanup runs even when `createAgentSession` throws; `close()` cleans up without a session | agent.model.ts |
| Preflight `keep_alive` 5m → 60m, matching server env | ollamaProvider.model.ts:86 |
| Log writes async (order-preserving promise queue) and `elapsed` heartbeat dropped from log.jsonl | messageBus.ts |
| Run workspace is `git init`ed with identity and `.gitignore` for `log/`; developer commits exactly once per iteration; reviewer target is `git show HEAD`, reading beyond the diff only when needed | workflow.ts, developerPrompt.md, reviewerPrompt.md |
| Shared byte-identical system-prompt prefix (`TEAM_PREFIX`) across all four agents for prompt-cache reuse | prompt.ts + agent classes |
| Prompt rule: sandbox writes only inside the workspace — fixtures under `test/` | developerPrompt.md, reviewerPrompt.md |
| Rework runs start with `get_story`; prior reviewResult/testResult findings are first priority (no note injection) | developerPrompt.md |
| `file://` URLs inside the workspace are rewritten to the static-server URL (agent-browser allowlist untouched); stale daemon reaped on `serve()` | browser.ts (`rewriteFileUrl`, tested) |
| `ui` story flag (optional, set by PO); screenshot-evidence gate only enforced for UI stories; tester prompt branches UI vs non-UI verification | story.model.ts, createStories.ts, updateStoryStatus.ts, poPrompt.md, testerPrompt.md |

## Remaining

| Priority | Item | Note |
| --- | --- | --- |
| P1 | No default `runTimeoutSeconds` | Intentionally skipped ("no run timeout"); with the bash timeout now present the hang surface is much smaller, but TUI runs still have no overall deadline. |
| P1 | Server binding: `ollama serve` binds `0.0.0.0` although tailscale serve only needs localhost | Ops fix in `tailscale.sh`; also make the script self-contained (export `OLLAMA_*` before `serve`) so non-interactive starts keep the tuning. |
| P2 | PO retry runs blind | Second PO run (workflow.ts:79-85) gets the identical prompt without the failure reason. |
| P2 | Resource loader reloaded per agent per iteration | agent.model.ts:76-81; small measured win. |
| P2 | Quant bump UD-Q3_K_XL | Only if review-quality failures persist after the token/prompt fixes — needs a new experiment to decide. |

## Verification

- 50 tests passed (109→111 expect calls across the session).
- TypeScript checking clean; the two pre-existing `spec.repeat` errors in scripts/experiment.ts are unrelated and were not introduced here.
- `rewriteFileUrl` gained a unit test covering workspace-internal and external `file://` URLs and percent-encoding.
