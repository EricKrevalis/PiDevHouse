# Experiment-4 Findings (post-fix rerun)

This document consolidates the findings from the experiment-4 log analysis (2026-08-28, second batch: 8 runs — f06-todo ×3 per variant, personal-recipe-vault ×1 per variant). A first batch ran before commit 44b1f9b (writable workspace root, tool budget 50→75, `maxTokens` 16k→32k) and was analyzed in the previous revision of this doc; that batch is archived in Trash. All runs below include the 44b1f9b fixes and were executed 15:41–18:13 on 28.08.

## Run Overview

| Run | Outcome | Duration | Tokens | Stories |
| --- | --- | --- | --- | --- |
| f06-todo baseline-run-1/2/3 | completed ×3 | 941 / 1395 / 1943 s | 928k / 813k / 1.87M | 1/1 tested (review 98/100/100, test 100; run-2 needed 3 iterations) |
| f06-todo one-iteration-run-1/2/3 | completed ×3 | 819 / 1143 / 868 s | 665k / 1.05M / 527k | 1/1 tested (review 95/100/100) |
| personal-recipe-vault baseline-run-1 | **error** | 4958 s | 2.62M | story 1 **tested** (r90, t100); story 2 stuck `in_progress` at run crash; 3–4 never started |
| personal-recipe-vault one-iteration-run-1 | incomplete | 1984 s | 1.57M | story 1 `in_progress` when `Tool call limit (75)` fired |

f06-todo is 6/6 with full screenshot evidence, same as the first batch. personal-recipe-vault improved from 0/2 with story 1 stuck: story 1 now passes review+test for the first time across experiments 3–4. Both recipe-vault runs still die before story 2 — but from two new, different causes (a harness crash and the raised budget).

## Fixes Verified (44b1f9b)

| Fix | Evidence in rerun |
| --- | --- |
| Writable workspace root, read-only `log/` | 0× `not a git repository`, 0× `Author identity unknown`, 0× `GIT_DIR` probing (first batch: 7 git errors + reviewer probing). Reviewer `git show HEAD` works; run dirs show clean per-iteration commits. |
| `maxToolCalls` 50 → 75 | f06-todo unaffected (13–50 dev tool calls). recipe-vault one-iteration hit the new 75-limit ("finalize now") — still below what a recipe-vault story needs. |
| `maxTokens` 16k → 32k | 0 truncation events (first batch: 1 output cut at exactly 16384 tokens with 432 s TTFT). Largest observed outputs < 24k. |
| Bash timeout containment | 1× 30 s timeout total; 0 server-launch dead calls (first batch: one `bun t.html` dev server burned 300 s = 22% of a run). |

## Stability Findings

| Priority | Area | Finding and evidence | Impact |
| --- | --- | --- | --- |
| P0 | Harness crash on non-finalized retry | recipe-vault baseline-run-1: after story 2 work (last tool call 15:07), the developer produced three consecutive thinking-only turns (10–11 min each, `ttft` 660/632/629 s, 0 tokens, 0 tool calls, no `update_story_status`), then the run aborted with `Cannot continue from message role: assistant` (pi-agent-core `agent.js:253`, via `agent-session.js:752 continue`). ~30 min of dead developer generation before the crash; the run itself was lost, not just the turn. | New failure class, kills the whole run. recipe-vault baseline was the most successful recipe-vault run ever (story 1 tested) — the crash forfeited stories 2–4. The retry/continue path must validate last-message role or catch-and-restart the session. |
| P0 | Tool budget vs story scope | recipe-vault one-iteration-run-1: developer reached `Tool call limit (75) reached; finalize now` with story 1 still `in_progress` (65 dev calls, 1.50M input tokens, 78 tool events after the warning). Story 1 of recipe-vault simply needs more than 75 calls. | Budget still sized below recipe-vault story scope. The durable fix is the PO splitting large stories; raising the budget further trades dead runs for dead spend. |
| P1 | Rework contained (maxIteration lever finally measured) | f06-todo baseline-run-2 needed 3 iterations (it1–it3, final review 100, test 100): 43 dev calls, 277k input tokens, total run 1395 s — median for the batch. | First real measurement of the iteration lever: rework no longer explodes cost (exp-3 outlier paid +1800 s for a failed-review replay). Same-session continuation + review-findings-first prompt works. |
| P2 | Sandbox flailing | 7 `Tool paths must stay inside` violations (5 recipe-vault baseline, 2 f06 one-iteration-run-2), down from 8; 0 read-only-fs probes (`mkdir tmp-test`, `mount`) this batch; 0 `--separate-git-dir` misuse. | 1–2 dead generations per run remain; mostly writes outside `src/`/`test/`. |
| P2 | Agent retries | 3 `agent_retry` events across 8 runs (2× f06-todo baseline-run-1: developer "not finalized" + tester "no test result"; 1× recipe-vault one-iteration). First batch: 5. | Nudge-path cost is one extra generation each; the crash above is the dangerous variant of the same path. |
| P2 | Compaction | 2 compactions: f06-todo baseline-run-3 developer (context peaked 63k), recipe-vault baseline developer (49k). | Compaction threshold is reachable on recipe-vault-scale stories and on a 3-iteration f06 run; watch after the budget/story fixes. |
| P2 | Fixed from earlier batches | 0× `No hostname in URL`; 0 JSON parse errors, degenerate loops, or hangs; story-scoped evidence naming intact; `ui`-flag gating correct. | The exp-3/F06 failure classes stay closed. |

## Speed Findings

| Priority | Area | Finding and evidence | Impact |
| --- | --- | --- | --- |
| P0 | Time decomposition | On live calls, TTFT sum is 40–53% of wall time (f06-todo baseline-run-2: 732 s of 1395 s; recipe-vault one-iteration: 923 s of 1984 s). Tool execution stays ≤ seconds per call. Generation throughput uniform ~39–45 tok/s. | The exp-3 bottleneck is untouched: wall time is still roughly half re-processed prompt + thinking. No fix so far has moved it. |
| P1 | recipe-vault story 1 completes | baseline-run-1: story 1 `tested` (r90/t100) within one iteration, ~2.6M tokens for the whole run vs 682k–942k in the first batch that produced nothing. The 75-call budget and 32k tokens let the developer actually finish a large story. | The applied fixes converted recipe-vault from "all spend discarded" to one story banked per run. |
| P1 | f06-todo wall time | 819–1943 s vs first-batch 864–1396 s: best case improved (819 s), median improved (~1020 s vs ~1279 s), but variance grew — baseline-run-3 spent 1.34M input tokens (compaction at 63k context) for 1943 s. | Same order of magnitude; no regression, but context growth (run-3) is the new speed risk on f06-todo. |
| P2 | Tester call volume | Tester remains the busiest agent: 33–70 calls and 312k–874k input tokens per f06-todo run (browser-heavy, ~10k context per call — prefix-cache friendly). | Volume, not depth; unchanged from first batch. |
| P2 | Context growth | Developer avg context/call: 6.9k–19.1k on f06-todo, 21.9k–22.4k on recipe-vault; max observed 63k (compaction trigger). | Same profile as first batch; recipe-vault-scale context pressure remains the wall the budget fix pushed against. |

## Cross-Cutting Interpretation

The 44b1f9b fixes are verified effective in production runs: the git/`​.git` failure class is fully closed, truncation is gone, and recipe-vault story 1 — stuck since experiment-3 — now passes review and test. What remains is (1) a new harness crash in the continue/retry path that forfeits whole runs, and (2) the tool budget still being sized below recipe-vault story scope. Both are structural, not model-level. The TTFT bottleneck (~half of wall time) is unchanged and is now the only large speed lever left.

## Applied Since (post-rerun session)

| Fix | Where | Addresses |
| --- | --- | --- |
| Retry-once on `Cannot continue from message role: assistant`: the queued continuation can race the queue drain in pi-agent-core and throw on the finished assistant turn; the transcript is intact, so a fresh user message continues it cleanly. Applied in `promptSession` so every nudge/retry call site is covered. | agent.model.ts (+ unit test) | P0 harness crash that forfeited recipe-vault baseline-run-1 |
| Tool budget 75 → 100 | config.model.ts:17 | P0: recipe-vault story 1 needs > 75 calls; the scope counter is already per story-iteration invocation, so no per-story reset exists to make |
| Path scope widened from `src`/`test` to the workspace root, matching the now-writable sandbox; `scopeToolCalls` takes an explicit workspace so relative paths still resolve against it | agent.model.ts, scope.ts | P2 path violations (writes to workspace root, e.g. `package.json`, were blocked although the sandbox allows them) |
| Left as is | — | P2 agent retries (contained nudge path; its dangerous variant is the crash fixed above), P2 compaction (watch only) |

## Remaining

| Priority | Item | Note |
| --- | --- | --- |
| P0 | TTFT / prompt re-processing (40–53% of wall) | Parallel server slots per agent or server-side cache persistence; nothing else moves wall time measurably. |
| P1 | Investigate the three thinking-only developer turns | The crash retry converts a lost run into a contained one, but the root cause (10-min thinking turns with no tool call at ~44k context, no cap hit) is unexplained. |
| P2 | `/tmp` still tmpfs in sandbox | Remaining path violations; a writable `/tmp` bind would remove the last flailing surface. |
| P2 | Carried from exp-3: no `runTimeoutSeconds`, the model server binds `0.0.0.0`, PO retry runs blind, resource loader reloaded per agent per iteration | Unchanged. |

## Verification

- Findings derived from `packages/core/runs/experiment-4/personal-recipe-vault-f06-todo/*/*/log/log.jsonl` and `summary.json` (8/8 runs parsed; event-type counts, dead-call/TTFT/context aggregation scripts in /tmp/opencode).
- Crash stack copied from `personal-recipe-vault/baseline-run-1/summary.json` (`error.stack`).
- Fix-verification claims checked against the run logs via grep (git errors, tool-limit messages, truncation at 16384/32768, path violations, timeouts) and against `bash.ts:89–98`, `config.model.ts:17`, `llamaProvider.model.ts`.
- No source code was changed during the log analysis; the fixes in "Applied Since" were added afterwards in the same session and verified with the full test suite (51 tests pass) and `tsc --noEmit` (only the two pre-existing `spec.repeat` errors in scripts/experiment.ts remain).
