# F06 improvement plan

Date: 2026-08-25. Evidence: the [runtime research](./f06-runtime-improvements.md), the completed runs in the [current experiment](../../packages/core/runs/f06-2026-08-25T14-25-06.217Z/experiment.json), and their JSONL logs.

## Findings

- The old batch completed 0/9 trials: one timeout and eight OpenTUI `TextBuffer` failures. Fresh worker processes have prevented that failure in the first two completed reruns, so isolation is helping.
- The reruns are still 0/2. Baseline timed out after 1,799 seconds and 90 model calls with only story 1 approved. The one-iteration variant stopped after 863 seconds and 34 calls with story 1 still `in_progress`.
- The main blocker is stage finalization. Agents reach the 20-call limit before `update_story_status` or `update_validation_result`, but the workflow advances anyway. Missing tester finalization then sends an already-correct implementation back to the developer.
- Browser validation is the largest avoidable delay. Baseline testing took 760 seconds, including ten Chromium attempts and one 300-second hang. The one-iteration reviewer also spent about 113 seconds on failed Chromium attempts.
- Raising the timeout will not fix either problem. It will spend more time in the same loops.

## Priority 1: successful runs

1. Make story control writes reliable. Do not count `update_story_status` and `update_validation_result` against the exploratory tool budget. After each role, verify the required state before invoking the next role: `implemented` before review, `approved` before test, and `tested` before completion. Report a specific budget or stage failure instead of continuing with stale state.
2. Make browser validation deterministic. Preflight one repository-owned browser command before each trial, cap it at 30 seconds, and allow one tester retry. Classify browser startup, CDP, or automation failure as infrastructure failure. Never route it back to development unless the tester found an application defect.
3. Finish experiment isolation. Run the batch controller headlessly by default, keep the TUI optional, record worker exit and peak memory, and stop a balanced block after a repeated infrastructure failure. Run an Ollama canary after a timeout before accepting another trial.
4. Use a reliability gate before tuning performance: three consecutive clean baseline runs must finish with every story `tested`, no infrastructure failure, and no forced process kill.

## Priority 2: speed

1. Use one end-to-end story for this small, single-file benchmark. Four dependent stories multiply the developer-reviewer-tester cycle without producing independently useful output.
2. Seed each workspace with the known runtime and validation commands. The logs show repeated searches for Node, Bun, Chromium, and test strategies even though the environment is fixed.
3. After the reliability gate passes, reduce role-specific model-turn and thinking budgets one role at a time. Start with product owner, reviewer, and tester; keep developer limits unchanged until measurements show spare budget.
4. Compare changes by valid-run median duration, model calls, and input tokens. Do not count infrastructure failures as fast task runs.

| Order | Change | Evidence | Exit criterion |
| --- | --- | --- | --- |
| P1.1 | Exempt control writes and gate every stage transition | Both reruns lost required final writes at the 20-call cap | A capped role either commits its required state or ends with a specific stage failure; no later role starts from an invalid state |
| P1.2 | Add one bounded browser harness and tester-only retry | Baseline tester used 760 s; repeated Chromium attempts failed or hung | Browser canary passes; each validation uses at most two attempts and 60 s total |
| P1.3 | Make experiment control headless and classify infrastructure failures | The old shared TUI invalidated eight trials | A repeated infrastructure error stops the block and is not scored as a task failure |
| P1.4 | Prove reliability | Current isolated reruns are 0/2 | 3/3 clean baseline runs finish with all stories `tested` |
| P2.1 | Use one vertical story for F06 | Story 1 consumed the full 30-minute baseline while three stories remained untouched | One implementation-review-test cycle covers all todo behaviours |
| P2.2 | Seed exact environment commands | Agents repeatedly probed unavailable Node/npm and built temporary browser harnesses | No runtime-discovery calls and no agent-authored CDP harnesses in valid runs |
| P2.3 | Tune role budgets from measurements | Reviewer and tester consumed 66% of baseline wall time | Lower valid-run median duration without reducing the 3/3 success gate |
