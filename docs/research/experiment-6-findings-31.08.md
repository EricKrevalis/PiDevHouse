# Experiment-6 Findings (31.08, in progress)

Experiment-6 started 16:09 on 31.08 (qwen3.8-mtp, git c51062d9 + dirty) and is still running. It includes all post-experiment-4 fixes: retry-once on `Cannot continue from message role` (agent.model.ts:151-169), `maxToolCalls` 75→100 (config.model.ts:16), workspace-root path scope (scope.ts). At analysis time: personal-recipe-vault baseline-run-1 finished (`incomplete`), f06-todo baseline-run-1 was mid-reviewer (~10 min in, healthy: 90 s total TTFT = 16% of wall, developer finished story in one pass, 0 real errors). The remaining 5 f06-todo runs had not started. All numbers below are from the one completed run; f06 observations are provisional.

## Run Overview

| Run | Outcome | Duration | Tokens (in/out) | Stories |
| --- | --- | --- | --- | --- |
| personal-recipe-vault baseline-run-1 | **incomplete** | 2552 s (0:42:32) | 177k / 74k | story 1 approved (review 91, **no test score**), stories 2–3 `todo`, never started |
| f06-todo baseline-run-1 | in progress (mid-reviewer) | >631 s | n/a | story 1 implemented, review in progress |

## Prior-Fix Status (exp-4 "Applied Since")

| Fix | Status in exp-6 |
| --- | --- |
| Retry-once on `Cannot continue from message role: assistant` | Verified not needed: 0 occurrences; no harness crash. Closed this run (n=1). |
| `maxToolCalls` 100 | Developer used 50, never hit the limit — story 1 completes inside budget. Closed. |
| Workspace-root path scope | 0× `Tool paths must stay inside` across both logs (was 7 in exp-4). Closed. |
| Truncation at 32k output | **Regression**: 1 truncation (exp-4: 0). Tester bash call cut at the output cap, tool not executed. |
| Thinking-only turns (exp-4 P1 open item) | **Recurring**: final tester turn (16:51:11–16:52:08) generated 57 s of thinking, no tool call, no result. |
| `/tmp` tmpfs (exp-4 P2 open item) | **Still open, costlier**: 6 dead tester calls (16:25–16:37) — `bun build --outdir /tmp/rv-dist` results vanish between calls. |

## Interpretation

The run was not lost to a crash this time — it was lost to a graceful abort: the tester (the same agent that is 78% of wall time) spent 28 minutes fighting the sandbox, hit the 32k output cap with one giant bash script, got one generic nudge, answered with a thinking-only no-op, and the harness translated that single story's missing test result into `incomplete` for the whole run (storyLoop.ts:112 → workflow.ts:108-111), forfeiting stories 2–3 that were ready to go. The exp-4 P0 crash class stays closed and the budget/scope fixes held, but the failure moved one level up: from "the session cannot continue" to "one validation agent gave up, so the run stops".

## Prioritized: Stability

| Priority | Cause | Proposed fix |
| --- | --- | --- |
| P0 | One story's `incomplete` aborts the whole run: tester recorded no test result → `validate()` returns undefined → storyLoop.ts:112 → workflow.ts:108-111 breaks the while loop with stories 2–3 still `todo`. Story 1 was already approved (r91) — 42 min banked, rest forfeited. | In workflow.ts, on `incomplete`/`max_iterations` mark the story failed and continue with the next ready story; abort only on `error`/`infrastructure`. Converts run-loss into per-story loss. |
| P0 | Single generic nudge is fragile: after the truncated turn, storyLoop.ts:64-71 sends "No test result was recorded…" once; the model replied with a 57 s thinking-only turn and the run ended. | Make the nudge name the actual failure (it sees the truncated tool call) — "your last tool call hit the output limit; re-issue it in smaller pieces" — and allow a second nudge round before giving up. |
| P1 | Output-token truncation: one tester bash call hit the 32k cap (llamaProvider.model.ts:41), heredoc script cut mid-args, tool not executed (log 16:48:30). Model-level: all other calls stayed <5k output. | testerPrompt.md: "split scripts >~50 lines into separate calls". Leave `maxTokens` at 32k — raising it trades truncation for degenerate output. |
| P2 | 7 tester compactions invisible in log.jsonl: agentEventBridge.ts has no `compaction_*` case, they only appear in summary.json. | Publish `compaction_end` via AgentEventBridge (one switch case). |
| P2 | `/tmp` scratch non-persistent across bash calls (fresh tmpfs per sandbox): 6 dead tester calls rebuilding into `/tmp/rv-dist` (16:25–16:37). Carried from exp-4. | Writable `/tmp` bind in the sandbox, or AGENTS.md note "keep scratch under `.scratch/` in the workspace". |
| P2 | 3 dead calls: 2× developer `edit` "Could not find the exact text", 1× tester read `AGENTS.md` at root (lives at `src/AGENTS.md`). | Leave as is — model-level, 3 calls total, self-recovered. |

## Prioritized: Speedup

| Priority | Cause | Proposed fix |
| --- | --- | --- |
| P0 | TTFT/prefill is 58% of wall (1482 s of 2552 s, summary callLog): tester 992 s (top calls 125/110/109/107 s), developer 336 s (max 73 s), reviewer 115 s. Carried exp-4 P0, now with a per-agent worst case. | Unchanged from exp-4: parallel server slots per agent or persistent server-side prefix cache. Nothing else measurably moves it. |
| P0 | Tester = 78% of run wall (1004 s generation + 992 s TTFT) and all 7 compactions; each compaction rewrites the context and evicts the llama.cpp prefix cache, so the next call pays 100 s+ prefill — compaction is currently cache-hostile. Trigger: a 28-min kept session with full-file reads and browser outputs. | Tighten `trimToolOutputs` for the tester (drop stale read/browser outputs before compaction is needed) and add a testerPrompt rule to avoid whole-file reads (`grep`/`sed -n` ranges). Watch whether compaction count drops. |
| P1 | UI story shipped without a browser entry: no `index.html` anywhere in the workspace, so the documented serve URL (`src/index.html`, browser.ts:28) 404'd; the tester pivoted to a 19-min bun-build/serve detour (15 calls, incl. the `/tmp` failures). | developerPrompt.md: a UI story must ship a browser-openable `index.html` entry; testerPrompt already covers the rest. One prompt line removes the entire detour class. |
| P2 | Tool execution is 55 s = 2% of wall; largest single call 12 s. | Leave as is. |
| P2 | f06-todo so far cheap: TTFT 90 s total (16%), developer one-pass, 15 calls. | Watch the tester phase; no action yet. |
