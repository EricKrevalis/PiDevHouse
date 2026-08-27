# F06 Findings

This document consolidates the findings from the latest F06 experiment, the earlier `TextBuffer` investigation, and the speed/context analysis.

## Original Findings

| Priority | Area | Finding and evidence | Impact |
| --- | --- | --- | --- |
| P0 | Completion | Only 2/12 latest trials succeeded. Testers frequently hit `Tool call limit (30) reached`, for example `f06-todo/baseline-run-1/log/log.jsonl:3292`. | Runs stop before all stories and acceptance criteria are completed. |
| P0 | Evidence | Screenshot evidence was incomplete. `f06-todo/baseline-run-3` had 6 acceptance criteria but only 3 screenshots. | Test results cannot prove every criterion. |
| P0 | Evidence isolation | Evidence from different stories could overwrite each other. Recipe baseline run 3 had 3 stories but only `ac-1.png` through `ac-3.png`. | A screenshot may represent the wrong story or criterion. |
| P0 | Browser reliability | Repeated `No hostname in URL: file://...` errors and long browser hangs occurred. | Browser validation consumes the run budget without producing reliable evidence. |
| P1 | Stage control | Reviewers sometimes advanced invalid stages. Logs show failed status transitions after budget exhaustion. | Later stages run against stale or incomplete state. |
| P1 | Story generation | The product owner generated malformed or duplicated stories, including `":x"` criteria and duplicate-ID retries. | Invalid planning increases retries and creates avoidable downstream work. |
| P1 | Generated application | Genuine app failures included invalid `new Bun.serve(...)` usage, missing selectors, and missing CSS. | Some failures are product defects rather than harness failures. |

## Speed and Context Findings

| Priority | Area | Finding and evidence | Impact |
| --- | --- | --- | --- |
| P1 | Context pressure | Context-window pressure likely slowed and destabilized long loops. The successful recipe baseline used 85 developer and 68 tester model calls, with 841,669 developer and 809,196 tester input tokens. The recorded 32,768-token context, large output budget, and Pi compaction defaults created a poorly balanced budget. | Larger requests take longer, compaction becomes expensive, and agents reach tool or time limits before finalizing. Exact causality still needs per-call context and compaction measurements. |
| P2 | Model call volume | The successful recipe baseline used 85 developer and 68 tester model calls with very large input totals. | The flow is functionally successful but inefficient and expensive in wall-clock time. |

## Cross-Cutting Interpretation

The earlier `TextBuffer` problem is consistent with the existing research report's TUI/native-resource diagnosis. Fresh worker isolation appears to have removed that failure from the latest batch, but the experiment has not yet been rerun after those changes. The old `TextBuffer` batch should therefore be retained as infrastructure evidence, not used to compare task or speed performance.

The current experiment is not yet a valid performance comparison. The first priority is three clean baseline runs with complete story finalization, complete screenshot evidence, no infrastructure failures, and no forced process termination. Only then should speed changes be compared using valid-run duration, model turns, tool calls, and input-token totals.

## Verification

- 47 tests passed.
- Changed seams pass TypeScript checking.
- Experiment dry run confirms 12 trials.
- Full TUI bundling remains blocked by missing optional OpenTUI native platform packages in the environment.
