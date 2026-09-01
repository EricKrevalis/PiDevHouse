# Experiment-12 Findings (01.09, final)

Experiment-12 ran 7 runs on commit `1db8a183` (dirty) — dirty state = staged trim removal (trim.ts deleted, `evictStaleToolResults` per tester instead), `contextWindow` 65k→32k (llamaProvider.model.ts:40), compaction settings `reserveTokens: 4_096 / keepRecentTokens: 12_000` (agent.model.ts:104), and the unstaged storyLoop re-prompt rewrites plus `return "incomplete"` → `continue` (storyLoop.ts:95-111). Aggregate: 19411 s wall, 1233 tool calls, 71 tool errors (41 bash, 14 browser, 7 edit, 2 read, 4 status-transition, 3 write), 22 compactions, 5 retries. No `Cannot continue from message role` failures, no workspace path violations, max tool-call use 72 of budget 100.

## Run Overview

| Run | Outcome | Duration | Tokens (in/out) | Stories |
| --- | --- | --- | --- | --- |
| personal-recipe-vault baseline-run-1 | **max_iterations** | 12604 s (3:30:04) | 697636 / 217268 | story 1 tested (96/100), story 2 stuck after 3 iterations, stories 3–4 `todo` |
| f06-todo baseline-run-1 | completed | 1498 s (0:24:58) | 65731 / 52449 | 2 stories tested |
| f06-todo baseline-run-2 | completed | 636 s (0:10:36) | 22358 / 23795 | story tested 100/100 |
| f06-todo baseline-run-3 | completed | 1103 s (0:18:23) | 57307 / 34949 | story tested 100/100 |
| f06-todo one-iteration-run-1 | completed | 1812 s (0:30:12) | 74498 / 68970 | 3 stories tested |
| f06-todo one-iteration-run-2 | **max_iterations** | 892 s (0:14:52) | 43346 / 34461 | story 2 review 30 / test 0 |
| f06-todo one-iteration-run-3 | **max_iterations** | 866 s (0:14:26) | 30233 / 33534 | reviewer 95, tester 50 (evaluator/spec drift) |

## Prior-Fix Status (exp-6 "Applied Since")

| Fix | Status in exp-12 |
| --- | --- |
| Retry-once on `Cannot continue from message role` | 0 occurrences across all 7 runs. Closed (n=7). |
| `maxToolCalls` 100 | Highest observed 72 calls per agent/story iteration; nobody hit the budget. Closed. |
| Workspace-root path scope | 0× path violations. Closed. |
| 32k output truncation (exp-6 P1) | Not reproduced: 0 output-limit hits, 0 role errors. The storyLoop re-prompts now name truncation explicitly as a precaution (storyLoop.ts:63-71, 84-90). Closed. |
| Trim → evict swap | Eviction held contexts small (largest observed 19542 input tokens, recipe tester); no context blowups. |
| Thinking-only turns (exp-4 P1) | Not re-confirmed as run-threatening this time; 5 retries total, all recovered. Watch. |
| Compaction visibility (exp-6 P2) | 22 compactions recorded in summaries; agentEventBridge still has no `compaction_*` case. Open. |

## Interpretation

The exp-6 P0 crash-and-forfeit class is gone: with `continue` in storyLoop.ts:95-111 a stuck story no longer aborts the run, and every f06-todo loss is now a per-story loss — but all three `max_iterations` outcomes are the new shape of failure: the reviewer/tester loop sends a story back to the developer until the iteration budget dies (run-lost at 12604 s for personal-recipe-vault, story-lost twice in f06-todo), with evaluator/spec drift (tester 50 on run-3, review 30 on run-2) as the recurring trigger. Speed is unchanged from exp-4/6: tool time is noise (35.1 s of 1498 s in f06 baseline-run-1), prefill/generation is the run, with TTFT outliers up to 199 s, and identical-task baselines swing 636 s–1498 s (2.4×).

## Prioritized: Stability

| Priority | Cause | Proposed fix |
| --- | --- | --- |
| P0 | personal-recipe-vault baseline-run-1 run-lost: story 2 cycled dev→review 3× and never converged; `continue` kept the loop alive until `max_iterations` at 12604 s, forfeiting stories 3–4 (`todo`). Model-level: the story never met review score, but nothing caps per-story retries. | Cap per-story dev→review cycles (e.g. 2) in storyLoop.ts; on exhaustion mark the story failed and move to the next ready story instead of burning the remaining budget on it. |
| P0 | Evaluator/spec drift loses one-iteration runs: run-2 story 2 scored review 30/test 0, run-3 tester scored 50 explicitly due to evaluator/spec drift — the story re-enters dev with a moving target until budget death (storyLoop.ts:104-111). | Pin the evaluation target: include the story's acceptance criteria verbatim in reviewer/tester prompts and require the score rationale to quote the criterion it fails; drift then becomes visible and auditable instead of a silent loop. |
| P1 | 22 compactions (developer/PO; tester compaction disabled at tester.agent.ts:58) each rewrite context and evict the llama.cpp prefix cache, forcing 100 s+ prefill on the next call — cache-hostile, carried from exp-6. | Extend `setCompactionEnabled(false)` + evict to developer/PO, or raise `keepRecentTokens` (agent.model.ts:104) and watch compaction count drop to 0. |
| P2 | 4 status-transition tool errors + 3 write errors; agents re-issued correctly. | Leave as is — self-recovered, model-level. |
| P2 | 41 bash + 14 browser errors (77% of 71 tool errors), all recovered within the iteration. | Leave as is; no run was lost to them. |

## Prioritized: Speedup

| Priority | Cause | Proposed fix |
| --- | --- | --- |
| P0 | TTFT/prefill dominates: outliers 199.26 / 194.93 / 168.00 s (recipe developer); tool execution 35.1 s of 1498 s wall in f06 baseline-run-1 (<2.5%). Carried exp-4/6 P0. | Unchanged: parallel server slots per agent or persistent server-side prefix cache. Nothing else measurably moves it. |
| P0 | Identical-task baseline variance 636–1498 s (2.4×) across f06-todo runs 1–3 — same code, same model; compaction + evict ordering decide whether the prefix cache survives. | Fix the P1 compaction item; then re-measure variance before touching anything else. |
| P1 | one-iteration-run-1 (1812 s) is the slowest f06 run despite the variant name: 3 stories × full test passes, 74498/68970 tokens — per-story validation cost scales linearly and the tester is still the most expensive phase. | Batch tester validation per story only after all stories are implemented, or run tester sessions concurrently per story if server slots allow. |
| P2 | Contexts stay lean post-evict (max 19542 input tokens); 32k window caused no observable pressure. | Leave as is. |
