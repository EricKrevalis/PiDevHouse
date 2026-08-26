# F06 runtime improvements

Research date: 2026-08-25. Scope: Bun 1.3.13, `@earendil-works/pi-*` 0.84.3, OpenTUI 0.5.8, and the recorded F06 runs. No application code was changed.

## Conclusions

1. `Failed to create TextBuffer` is not an Ollama/OpenAI error. **Sourced fact:** OpenTUI throws that exact string when its native `createTextBuffer` FFI call returns no handle ([OpenTUI 0.5.8 source](https://github.com/anomalyco/opentui/blob/v0.5.8/packages/core/src/zig.ts#L4903-L4907)). An upstream OpenTUI report records the same terminal error after native memory growth during LLM streaming ([issue #1321](https://github.com/anomalyco/opentui/issues/1321)); its specific markdown-highlighting cause was fixed by [PR #1331](https://github.com/anomalyco/opentui/pull/1331) before 0.5.8. **Inference:** the exact old defect is not established here, but a presentation/native-resource failure is much better supported than a provider failure. Capture the stack and RSS, and run experiments without the TUI.
2. Cancellation reaches pi and the OpenAI-compatible request, but lifecycle and outcome reporting need tightening. **Sourced fact:** Node's `AbortSignal.any()` preserves the triggering signal's `reason`, and `AbortSignal.timeout()` supplies the deadline signal ([Node 24 globals](https://nodejs.org/docs/latest-v24.x/api/globals.html#static-method-abortsignalanysignals)). Pi passes its active signal into provider streaming ([agent loop](https://github.com/earendil-works/pi/blob/v0.84.3/packages/agent/src/agent-loop.ts), [OpenAI completions adapter](https://github.com/earendil-works/pi/blob/v0.84.3/packages/ai/src/api/openai-completions.ts)); `AgentSession.abort()` waits for idle, while `dispose()` is the documented final cleanup path ([session source](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/agent-session.ts)). **Repository observation:** sessions are created per agent but never disposed, and timeout/abort errors are reduced to message strings.
3. Large cumulative input is expected from the current loop shape. **Sourced fact:** pi repeatedly calls the model while tool calls remain, appends every assistant/tool result to the current context, and only then sends the resulting message list on the next call ([agent loop](https://github.com/earendil-works/pi/blob/v0.84.3/packages/agent/src/agent-loop.ts), [message conversion](https://github.com/earendil-works/pi/blob/v0.84.3/packages/ai/src/api/openai-completions.ts)). Pi auto-compaction is checked at agent end; its default threshold is `contextWindow - 16,384`, and it keeps 20,000 recent tokens ([compaction docs](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/compaction.md), [session source](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/agent-session.ts)). **Inference:** auto-compaction cannot prevent growth inside one long tool loop, which is where these runs accumulate most calls.
4. The completed experiment cannot compare variants. **Repository observation:** the [experiment report](../../packages/core/runs/f06-2026-08-25T11-51-44.086Z/experiment.json) has one timeout followed by eight `TextBuffer` failures. All six `one-iteration` and `short-timeout` trials failed after only one product-owner call, before their changed settings could affect story execution. Variants ran in grouped order in one long-lived TUI process, whose log state was retained across trials. The report also records a dirty worktree. **Inference:** order, retained UI resources, and infrastructure failure dominate any variant effect.

| Variant | Successful runs | Durations | Terminal result | Deepest progress |
| --- | ---: | --- | --- | --- |
| `baseline` | 0/3 | 1,799 s, 1,033 s, 45 s | 1 timeout, 2 `TextBuffer` errors | One story tested; two more left implemented |
| `one-iteration` | 0/3 | 79 s, 60 s, 40 s | 3 `TextBuffer` errors | Product owner only |
| `short-timeout` | 0/3 | 41 s, 69 s, 47 s | 3 `TextBuffer` errors | Product owner only |
| **Total** | **0/9** | **3,213 s** | **1 timeout, 8 `TextBuffer` errors** | **Only 1 of 32 generated stories tested** |

## Evidence by symptom

### TextBuffer failure

**Repository observations**

- Baseline run 1 ran for 1,799 seconds and timed out after 97 model calls and 822,417 cumulative input tokens ([summary](../../packages/core/runs/f06-2026-08-25T11-51-44.086Z/baseline/run-1/build-an-interactive-web-todo-/2026-08-25T13-51-44/summary.json)).
- Baseline run 2 then ran for 1,033 seconds, made 69 model calls with 518,470 cumulative input tokens, and ended with `Failed to create TextBuffer` ([summary](../../packages/core/runs/f06-2026-08-25T11-51-44.086Z/baseline/run-2/build-an-interactive-web-todo-/2026-08-25T14-21-44/summary.json)). Every remaining trial failed with the same string after 40-79 seconds and only one model call.
- The TUI appends streamed text and every tool/status event to one unbounded `logs` signal; the experiment executes every trial through that same rendered app (`packages/core/src/tui/index.tsx`, `packages/core/scripts/experiment.ts`).

**Inference**

- The progression is consistent with retained/exhausted TUI resources contaminating later trials. It does not prove the precise allocation leak. The OpenTUI issue demonstrates that the same error can be the final symptom of native memory pressure, but its fixed markdown path is not used by this app's plain `<text>` log rows.

**Recommendations**

- P0: make the experiment runner headless and spawn a fresh worker process per trial. Keep TUI rendering outside the measured process.
- P0: capture the full error stack, `process.memoryUsage()` before/after each trial, event/log-row counts, and child exit status. Node documents RSS, heap, external, and array-buffer counters ([Node 24 process memory](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage)).
- P0: bound or clear displayed logs between interactive runs. Keep complete JSONL traces on disk rather than keeping every event rendered.
- P1: reproduce a single long run under Bun 1.3.13 and current Bun separately. Bun documents streaming response consumption, `AbortSignal.timeout()`, and `fetch` diagnostics; none document `TextBuffer`, reinforcing that the name belongs to the TUI layer ([Bun fetch](https://bun.sh/docs/runtime/networking/fetch)). Treat a runtime upgrade as an A/B diagnostic, not a presumed fix.

### Timeout and abort lifecycle

**Sourced facts**

- `AbortSignal.any()` adopts the reason from the signal that fired; `throwIfAborted()` throws that reason. Node recommends one-shot abort listeners to avoid leaks ([Node 24 globals](https://nodejs.org/docs/latest-v24.x/api/globals.html#class-abortsignal)).
- Pi 0.84.3 forwards cancellation to the OpenAI SDK request and made provider retry waits abortable in [PR #6980](https://github.com/earendil-works/pi/pull/6980).
- `AgentSession.abort()` aborts the current agent and waits until idle. `dispose()` additionally aborts retry/compaction/bash work, disconnects listeners, and cleans session resources ([session source](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/agent-session.ts)).
- A pi upstream report shows that an OpenAI-compatible SSE body can stall after headers/content because request timeout is not a stream inactivity timeout ([issue #7954](https://github.com/earendil-works/pi/issues/7954), auto-closed without a merged fix). An end-to-end deadline therefore remains necessary.
- Ollama has an open report that disconnected streaming requests can retain goroutines and runner semaphore slots ([issue #17131](https://github.com/ollama/ollama/issues/17131)). Applicability depends on the deployed Ollama version and request path.

**Recommendations**

- P0: preserve and record `runSignal.reason`; classify `TimeoutError`, operator cancellation, provider/network failure, TUI failure, and agent-budget termination separately. Do not collapse all of them into `outcome: "error"` plus a message.
- P0: after signalling abort, await session idle and dispose every completed session before starting the next agent or trial. Add a bounded shutdown grace period at the worker-process boundary.
- P0: after a timed-out/disconnected request, run an Ollama canary before the next measured trial. If health does not recover, restart/isolate the server or invalidate subsequent trials rather than continuing.
- P1: retain the overall deadline and add a shorter per-provider inactivity deadline only if the pi/Ollama path can distinguish silence from valid long generation. Avoid retrying non-idempotent tool execution automatically.

### Calls and context growth

**Sourced facts**

- Ollama's OpenAI-compatible `/v1/chat/completions` supports streaming, tools, usage, `max_tokens`, and seed, but not every OpenAI field ([compatibility matrix](https://docs.ollama.com/api/openai-compatibility)).
- The OpenAI-compatible API cannot set Ollama context size. Ollama requires a server setting or a model created with `PARAMETER num_ctx`; `/api/ps` reports the actually loaded `context_length`, digest, and VRAM use ([OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility#setting-the-context-size), [`/api/ps`](https://docs.ollama.com/api/ps)).
- Ollama currently defaults systems below 24 GiB VRAM to 4k context and says larger context consumes more memory ([context-length guide](https://docs.ollama.com/context-length)).
- Pi exposes `shouldStopAfterTurn` specifically so embedders can stop the otherwise continuing tool loop ([PR #7367](https://github.com/earendil-works/pi/pull/7367)).

**Repository observations and inference**

- The provider advertises 32,768 context and 16,384 maximum output tokens in application code. **Inference:** on the documented 16 GiB V100 deployment, Ollama may actually allocate only 4k unless explicitly configured. The client value does not configure the server.
- `maxToolCalls: 50` limits tools, not model turns. A model can make many calls while staying below that tool limit. Full tool outputs remain in the next request, so cumulative input grows with every turn.
- Pi's default `reserveTokens` (16,384) plus `keepRecentTokens` (20,000) exceeds the advertised 32,768 window. Even when compaction runs, those defaults are poorly matched to this model declaration.

**Recommendations**

- P0: query and record `/api/ps.context_length`, model digest, Ollama version, GPU split, and available memory before every batch. Refuse to run if actual context differs from the client declaration.
- P0: set one coherent budget across Ollama `num_ctx`, pi `contextWindow`, maximum output, compaction reserve/keep-recent, per-agent model-turn cap, and tool-call cap. Start below the verified hardware limit rather than advertising an unverified window.
- P0: cap model turns with pi's `shouldStopAfterTurn` hook or an equivalent orchestration boundary. A tool-call cap alone does not bound repeated LLM calls.
- P1: truncate/summarize large `read`, `grep`, and `bash` results before the next model call; prefer targeted reads. Stop and restart from a compact handoff before one prompt's tool loop becomes the entire context.
- P1: record per-call input/output tokens and stop reason, not only agent totals. This reveals whether growth comes from tool output, retries, compaction, or repeated validation loops.

### Experiment validity

**Recommendations (inference from the recorded design)**

- Discard the current batch for variant-effect claims; retain it as an infrastructure-failure case study.
- Require a passing preflight and canary, then execute each trial in a fresh process. Randomize or interleave variant order so time, model heat, endpoint load, and memory pressure do not align with one variant.
- Mark infrastructure failures as invalid trials, not negative task outcomes. Stop the batch after a repeated infrastructure class and rerun the whole balanced block after remediation.
- Pin and record git commit plus diff/cleanliness, Bun, pi packages, OpenTUI, Ollama version, model digest/quantization/context, seed/sampling settings, hardware state, and trial order. Ollama documents `seed` as supported for reproducible OpenAI-compatible requests, though tool/environment nondeterminism still remains.
- Compare task outcomes only after reporting infrastructure pass rate, timeout/abort latency, peak RSS, model/tool calls, and token totals. A variant that never reaches the changed orchestration path supplies no evidence about that variant.

## Priority table

| Priority | Change | Why it ranks here | Smallest useful verification |
| --- | --- | --- | --- |
| P0 | Run every experiment trial headlessly in a fresh worker process | The shared OpenTUI process is the best-supported cause of eight invalid trials. No variant conclusion is possible until trials are isolated. | Nine canary trials complete without `TextBuffer`; record worker exit code and peak RSS. |
| P0 | Bound or clear TUI rows and render lists with Solid's keyed `<For>` | `logs().map(...)` rebuilds an unbounded rendered history on every streamed delta. Keep full JSONL on disk, not in native text buffers. | Stream at least 10,000 deltas while RSS and rendered row count stay bounded. |
| P0 | Dispose every pi session in `finally`; preserve stack, cause, and abort reason | Sessions currently outlive their work, while every failure is reduced to one message. Cleanup and diagnosis are prerequisites for reliable reruns. | A timeout settles, disposes the session, reports `timeout`, and the next canary succeeds. |
| P0 | Verify `/api/ps.context_length` and align Ollama, pi, output, and compaction budgets | The client advertises 32,768 tokens but does not configure Ollama. On the documented hardware Ollama may load 4k, making current compaction settings incoherent. | Preflight fails on a context mismatch and records model digest, context, and GPU split on success. |
| P1 | Add a per-agent model-turn cap and reduce the 50-call tool allowance | Two useful runs consumed 97 and 69 model calls, 822k and 518k cumulative input tokens, without completing the task. Tool limits alone do not cap turns. | Summary reports turn/tool stop reasons; a stuck agent exits within the configured budget. |
| P1 | Resume at the failed developer/reviewer/tester stage | The loop restarts development after tester infrastructure failures and repeats already-passing work. | A forced tester setup failure retries or stops at testing without another developer invocation. |
| P1 | Coalesce persisted text deltas and record per-call usage and stop reasons | Thousands of low-value events stress the UI while aggregate agent totals hide where context grows. | One completed message replaces its deltas in the diagnostic view; per-call tokens remain available. |
| P1 | Randomize or interleave variants and mark infrastructure failures invalid | Grouped order aligns each variant with accumulated process state. Failed preconditions currently count as task failures. | A rerun records trial order and has balanced valid samples for every variant. |
| P2 | A/B current Bun and OpenTUI releases after isolation | An upgrade may help, but changing dependencies before reproducing the leak would hide rather than establish the cause. | The same isolated stress case runs against pinned old and current versions. |
