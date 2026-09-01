# Architecture and control surface

Last updated 2026-09-01, after two independent reviews (architecture leverage,
code defects) corrected an earlier draft and the fixes they prompted landed.
Empirical claims below are counted over the 70 `summary.json` and 57
`stories.json` archived under `output/`.

What this file is for: one place that describes the whole pipeline, every knob
that steers it, and which artifact records what happened at each step. Written
so a reviewer (human or agent) can read it alongside a run's `summary.json` and
`log/outputlog.jsonl` and say "the problem is in stage N, and the lever for it
is X" without reading the whole source tree first.

Two ways to use it:

- **Top-level improvement pass.** Read "The pipeline" and "Control surface",
  then ask what the design cannot currently express or measure.
- **Log-driven debugging pass.** Read "Failure taxonomy" and "Where evidence
  lives", take a failing run, walk it to the stage that owns the failure, and
  pick the lever from that stage's row.

Everything here is descriptive of the tree as it stands, not aspirational.
Where something is known-missing it says so under "Known gaps".

---

## 1. What the system is

A request in, a working project out, produced by five single-purpose agents
against one local model. There is no shared conversation between agents. Every
agent invocation is a **fresh session** with its own system prompt, its own tool
allowlist, and its own tool-call budget. The only things that persist across
invocations are three files on disk:

| File | Written by | Read by | Role |
|---|---|---|---|
| `src/stories.json` | product owner (whole file), developer/reviewer/tester (single fields) | everyone | the run's state machine and the only inter-agent channel |
| `src/AGENTS.md` | developer, tester | **every** agent | shared environment lessons, carried forward within a run. the resource loader injects it into every context, product owner and guide included, so it is a context cost even for agents that cannot act on it |
| the workspace tree `src/` | developer | everyone | the actual deliverable |

That is the central design fact and the source of most of the leverage:
**agents coordinate exclusively through structured file state, never through
chat history.** Every steering decision is therefore either a prompt change, a
tool change, a budget change, or a change to what `stories.json` can express.

Code map:

```
packages/core/src/
  runtime/workflow.ts          stage 1-2-6: run setup, dependency scheduling, teardown
  runtime/storyRunner.ts       stage 3-4-5: the per-story iteration loop and its gates
  modules/agents/*.agent.ts    the five role prompts + tool allowlists
  modules/model/agents/agent.model.ts   session lifecycle, timeout, verdict recovery
  modules/tools/registry.ts    tool wiring
  modules/tools/bash.ts        the bash sandbox (denylist, roots, prompt text)
  modules/tools/scope.ts       path scoping, write access, per-invocation call budget
  modules/tools/story/*        stories.json read/write with schema validation
  modules/service/*            event bus, jsonl log, summary, failure class, aggregation
```

---

## 2. The pipeline

Six stages. Each row below is expanded in section 3.

```
        request
           |
  [1] run setup            workflow.ts        create dirs, resolve model, seed AGENTS.md
           |
  [2] planning             po.agent.ts        request -> stories.json  (2 attempts)
           |
  [3] scheduling           workflow.ts        pick ready stories, loop until terminal
           |
     for each ready story:
           |
  [4] implement            developer.agent.ts  edit code, set status
           |
  [5] gate: review         reviewer.agent.ts   write reviewResult {score, note}
      gate: test           tester.agent.ts     write testResult {score, note}
           |               storyRunner.ts      score >= minScore ? advance : iterate
           |
  [6] finish               guide.agent.ts      emit the RUN: command
                           summaryCollector    write summary.json
```

### Stage 1: run setup (`workflow.ts`)

Creates `output/<slug>/<timestamp>-<runid>/` with `src/`, `log/`, `test/`,
seeds an empty `AGENTS.md` with three fixed headings, resolves the Ollama
provider, and starts two clocks: the per-invocation timeout and the run
deadline.

The three `AGENTS.md` headings (`## Commands`, `## Sandbox and paths`,
`## Browser testing`) are a real steering lever and easy to overlook: they
predetermine how agents file what they learn, and an agent will not invent a
fourth heading.

### Stage 2: planning (`po.agent.ts`)

One agent, one tool (`write_stories`), no filesystem access. Turns the request
into an ordered story list. Retried **once** if `stories.json` comes back
missing or schema-invalid; a second failure ends the run as `planning`.

This is the highest-leverage stage in the whole system and the least
instrumented one. Story granularity decided here fixes the cost of every later
stage: the number of developer invocations, the number of gate invocations, the
depth of the dependency chain, and whether a single blocked story strands the
rest. The prompt fights a specific known failure (one story per arithmetic
operator) with explicit anti-splitting rules and a "no pure scaffolding" rule.

Nothing downstream can recover from a bad plan. There is no replanning stage.

### Stage 3: scheduling (`workflow.ts`, the `while` loop)

Repeatedly selects stories whose status is `todo` and whose every `blockedBy`
dependency has reached the terminal status, then runs them **sequentially**.
When no story is ready and not all are terminal, the run ends `incomplete`. Any
story still on `todo` at teardown is marked `skippedByDependency`, on every exit
path including the run deadline, an abort and a thrown error.

The terminal status is derived from which gates are on: `tested` with a tester,
else `approved` with a reviewer, else `implemented`.

Consequences worth knowing: dependencies are hard, not advisory. One blocked
story silently costs every story downstream of it, which is why the
skipped-story count exists as a separate metric. And `ready` stories run one at
a time even though nothing in the design requires it.

Measured, and load-bearing for anything proposed here: across all 57 archived
`stories.json`, **every plan is a strict linear chain** (exactly n−1 of n
stories carry a dependency, and not one file has two dependency-free stories).
So `ready.length` is structurally 1 and the scheduler's sequentiality has never
cost anything. Story granularity and chain depth are decided in stage 2; that is
where the lever is, not here. The `plan` block in the summary records the shape
so this stays checkable rather than assumed.

### Stage 4: implement (`developer.agent.ts`)

Full read/write/edit/bash on the workspace. 45 tool calls. Sets story status to
`in_progress` before its first edit and `implemented` when done, via
`update_story_fields` restricted to the `status` field only.

The prompt's load-bearing parts: read open findings first on a rework pass;
preserve code that already passed review and touch only the open findings;
leave browser testing to the tester; append durable lessons to `AGENTS.md`
without duplicating existing entries.

Rework is where cost concentrates. Iteration 2+ of a story is a developer
invocation whose job is to clear findings, and the prompt has to actively
prevent it from rewriting approved code.

### Stage 5: the gates (`reviewer.agent.ts`, `tester.agent.ts`, `storyRunner.ts`)

Both gates are read-mostly agents whose *only* job is to write a verdict:
`{score, note}` into `reviewResult` or `testResult`. Both are `writeAccess:
"notes"`, meaning `write`/`edit` are refused for anything but `AGENTS.md`. The
tester additionally owns browser verification through `agent-browser` and
writes screenshots into `test/`.

The loop in `storyRunner.ts`, per iteration:

1. run the developer
2. if the reviewer is on: run it, read the verdict
   - no verdict written → **rerun the gate once**, then fall back to a
     developer iteration
   - `score < minScore` → next iteration; if the score failed to improve twice,
     block the story (plateau detection)
   - `score >= minScore` and no tester → done
3. if the tester is on: same shape; pass means terminal status, plateau means
   blocked
4. iterations exhausted → block the story

Four separate safety nets exist here because a **silent gate** (an invocation
that ends without writing a verdict) is the system's most damaging failure: it
consumes an iteration, teaches the loop nothing, and eventually blocks the story
along with everything depending on it. 18 of 22 blocked stories in the corpus
carry a silent gate as their recorded reason.

- `afterPrompt` re-prompts the agent when the verdict field is unchanged
- `finalize` runs that nudge on **both** exits from the turn, the normal one and
  the timeout one, bounded by its own 300s budget and cancellable by the run
  signal, and aborts the session if either wins. `session.prompt()` accepts
  neither a timeout nor a signal, so without this the nudge is unbounded
- verdict tools are exempt from the tool-call budget, so an exhausted agent can
  still record its result
- and if all three fail, `runGate` reruns the whole agent once with a fresh
  session and a fresh budget

One caveat on the fourth net: `runGate` detects silence by comparing the
verdict's `{score, note}` before and after. A gate that legitimately re-affirms
an identical verdict is indistinguishable from one that wrote nothing, so it
pays for a full extra invocation. Recording a write marker rather than comparing
values is the fix; it is not implemented.

### Stage 6: finish (`guide.agent.ts`, `summaryCollector.ts`)

The guide runs only when the story loop completed cleanly, reads the tree, and
emits one copy-pasteable `RUN:` command. Then `summary.json` is written
regardless of how the run ended, including when workspace creation itself
failed (it falls back to the output root).

---

## 3. Control surface

Everything that can be steered, grouped by mechanism. This is the menu an
improvement pass picks from.

### 3.1 Per-agent configuration (`*.agent.ts`)

Each agent declares four things, and these are the sharpest instruments in the
system because they are per-role rather than global.

| Agent | Tools | maxToolCalls | writeAccess | Story fields it may write |
|---|---|---|---|---|
| productOwner | `write_stories` | 25 (default) | all | whole file, minus the scores |
| developer | read, bash, edit, write, update_story_fields | 45 | all | `status` |
| reviewer | read, bash, grep, find, ls, update_story_fields | 45 | notes | `reviewResult`, `status` |
| tester | read, bash, edit, update_story_fields | 60 | notes | `status`, `testResult` |
| guide | read, ls | 25 (default) | all | none |

Read the tester's `edit` together with its `writeAccess: notes`: the scope guard
reduces that tool to `AGENTS.md` only. The tester cannot edit test files despite
holding a general-purpose edit tool.

Four independent axes here, all per-role:

- **tool allowlist** — the hardest constraint available. The reviewer cannot
  write implementation files because `write` is not in its list *and*
  `writeAccess: "notes"` blocks it a second time. Removing a tool is stronger
  than telling the model not to use it.
- **field allowlist** — `update_story_fields` builds its Zod schema from
  `allowedFields`, so the tool literally cannot express a forbidden write, and
  the model sees the restriction in the tool description.
- **maxToolCalls** — the per-invocation work budget. Verdict tools are exempt,
  and refused calls are counted separately rather than charged against it, with
  their own cap at `2 × maxToolCalls` to bound a refusal loop.
- **writeAccess** — `all` or `notes`, enforced in `scope.ts`.

### 3.2 Prompt structure (`agent.model.ts` `contextSections`)

Every user prompt is assembled as: the agent's own prompt, then appended
sections that the base class generates from live values.

- **`## Sandbox`** — appended for any agent with bash. Generated by
  `describeSandbox()` from the actual allowed roots and the actual
  `DENIED_COMMANDS` set, so the agents can never be told a rule that no longer
  matches the validator. This is the fix for agents burning calls discovering
  the sandbox by trial and error.
- **`## Time budget`** — appended when `timeoutMinutes > 0`, stating the
  minutes and telling the agent to record its best result before the limit.
- **`## Rework pass`** — appended from iteration 2 on, naming the pass number
  and that the recorded findings are what remains open. Without it a fourth
  rework prompt was byte-identical to the first.

Subclasses extend via `[...super.contextSections(), ...]`. Any new
globally-true fact belongs here, not copy-pasted into five prompts.

Prompt conventions in use, worth preserving: numbered `## Process` steps;
"done means X has been called this run" for gate agents; concrete
copy-pasteable command recipes (the tester's `agent-browser` block); explicit
score semantics (`-1` unverifiable, `<minScore` fail, `100` only on full
execution).

### 3.3 Run flags (`config.model.ts`)

| Flag | Default | Effect |
|---|---|---|
| `--max-iterations=N` | 4 | develop→gate cycles per story before blocking. also the default through the HTTP API, which used to disagree at 3 |
| `--min-score=N` | 75 | gate pass threshold, also written into the prompts |
| `--no-reviewer` | off | drops the review gate, terminal status becomes `approved`/`implemented` |
| `--no-tester` | off | drops the test gate |
| `--timeout-minutes=N` | 20 | ceiling on one agent invocation |
| `--max-run-minutes=N` | 120 | ceiling on the whole run |

`minScore` is a genuine two-place lever: it gates the loop *and* it is
interpolated into the reviewer and tester prompts, so the agent knows the bar
it is being held to. On the **review** gate. On the **test** gate it is
currently inert: across 164 story observations the tester has written only
`100` or `0` (never-written), plus two other values in the whole corpus, so any
threshold from 1 to 99 partitions the data identically and `trackPlateau` can
never fire on it. Treat the test score as a binary signal until that changes.

### 3.4 Model and sampling (environment, not flags)

`OLLAMA_MODEL`, `OLLAMA_CONTEXT_WINDOW`, `OLLAMA_MAX_TOKENS`, `OLLAMA_HOST`,
`THINKING_LEVEL` (`off|minimal|low|medium|high`, default `medium`, established
best `low`). Sampling parameters live in the Modelfile on the server, not here.
Server-level flash attention and KV cache quantization are set once at
`ollama serve` startup. See `docs/model-tuning.md`.

All of these are **run-global**. There is currently no way to give the tester a
different model or thinking level than the developer, which is the most
frequently wanted knob the system does not have.

### 3.5 The bash sandbox (`bash.ts`)

Enforced in `spawnHook` before anything executes; a rejected command is
rewritten to `echo <reason>; exit 1`, so the agent sees the reason as tool
output and can correct.

Rules: absolute paths must sit inside `src/`, `test/`, the run root, `/tmp`,
`/dev/null`; no command substitution or backticks; no `>` except `/dev/null`
and `2>&1`; no `curl -o/-O/--output` to anything but `/dev/null`; no nested
`bash -c`; no relative `..` escapes; a 33-command denylist; a 300s default
timeout on foreground commands.

Two things this stage also does that are easy to miss: `wrapBashCommand`
injects `AGENT_BROWSER_*` env vars on every call that passes validation (a
denied command is replaced wholesale, so it gets none of them), pinning
screenshot and download directories and capping browser output at 12000 chars;
and `afterToolCall` in `scope.ts` truncates any `read` or `bash` result over
4000 chars, a context-budget lever applied uniformly to every agent.

Note the asymmetry with the scope guard: a scope refusal **blocks** the call,
while a sandbox denial **rewrites** it into a failing `echo`, so the call
executes. That is why the two are counted as separate metrics.

### 3.6 What is deliberately *not* steerable

Worth stating so a reviewer does not propose it as new: agents cannot see each
other's transcripts, cannot write `stories.json` outside their allowed fields,
cannot write files outside the run tree, and cannot change their own budgets.

---

## 4. Failure taxonomy and which stage owns each

Two independent classifications exist and they answer different questions.

**`failureMode` (`workflow.ts`)** — where in the pipeline it broke:

| Mode | Meaning | Stage | First lever to reach for |
|---|---|---|---|
| `planning` | stories.json never produced or invalid twice | 2 | PO prompt, schema error text |
| `dependency` | nothing ready, nothing terminal | 3 | PO prompt (chain depth), story granularity |
| `recovery` | at least one story blocked | 4-5 | maxIterations, minScore, gate prompts |
| `timeout` | the **run** clock hit `maxRunMinutes`, or an error said "timeout" | any | maxRunMinutes, thinking level |
| `execution` | thrown error, invalid stories mid-run | any | code, not prompts |
| `cancelled` | user aborted | - | - |

The per-invocation timeout does **not** set `failureMode`. `prompt()` returns
normally after it and the agent gets its finalize pass, so it surfaces only as
`timedOutInvocations` on the agent's usage.

**`FailureClass` (`failureClassifier.ts`)** — *who* failed, so that model
comparisons are not polluted by infrastructure. Ordered, most specific first:

| Class | Meaning | Infrastructure? |
|---|---|---|
| `tool_hang` | a tool call at or past 300s. outranks the timeout it caused | yes |
| `agent_timeout` | an invocation used its whole budget with no hung command, so that time went into the model | no |
| `run_deadline` | the run clock cut it at `maxRunMinutes` while no invocation had timed out. what the model would have done with the rest is unknown, and the ceiling was the harness's choice | yes |
| `provider` | `outcome: "error"` | yes |
| `unknown` | no summary at all | yes |
| `model` | the residual | no |

Infrastructure classes are excluded from the comparable duration and token
stats, and from `validRunCount`. `cancelled` is excluded from both buckets.

**Silent gates** cut across both. Detected by `silentGates > 0` on a story,
with `gateRetries` recording how much rerunning was spent recovering. Root
causes seen so far: the invocation timeout firing before the verdict write (now
covered by `finalizeAfterTimeout`), and the tool-call budget refusing the
verdict write (now covered by the verdict-tool exemption).

---

## 5. Where evidence lives

For a log-driven pass, this is the lookup table.

| Question | Artifact | Field |
|---|---|---|
| what did the run do overall | `summary.json` | `outcome`, `failureMode`, `failureDetail`, `durationSeconds` |
| under what configuration | `summary.json` | `config`, `environment` (thinking level, ctx, maxTokens, host, commit), `model` |
| how much did each role cost | `summary.json` `agents.<role>` | `calls`, `inputTokens`, `outputTokens`, `reasoningTokens` |
| which role is slow | `summary.json` `agents.<role>` | `totalDurationMs`, `invocations`, `longestInvocationMs` |
| did an invocation get cut off | `summary.json` `agents.<role>` | `timedOutInvocations` |
| did a command hang | `summary.json` `agents.<role>` | `longestToolCallMs` (>= 300000 means hang) |
| how many tool calls actually ran | `summary.json` `agents.<role>` | `executedToolCalls` (the denominator for the two below; `calls` counts assistant turns, not tool calls) |
| calls the scope guard refused | `summary.json` `agents.<role>` | `rejectedToolCalls` (out of scope, wrong write target, over budget) |
| commands the sandbox denied | `summary.json` `agents.<role>` | `sandboxDenials` — historically the larger waste channel, and invisible to the field above because a denial executes |
| what the plan looked like | `summary.json` `plan` | `storyCount`, `maxChainDepth`, `rootStories`, `criteriaPerStory`, `firstStoryCriteria` |
| per-story trajectory | `summary.json` `stories[]` | `iterations`, `reviewTrajectory`, `testTrajectory` — verdicts that were **persisted**, recorded on a successful tool result and filed under the story the call named |
| why a story blocked | `summary.json` `stories[]` | `blockedReason`; plus `silentGates` and `gateRetries`, which are recorded for every story, not only blocked ones |
| what was never attempted | `summary.json` `stories[]` | `skippedByDependency` |
| the actual turn-by-turn record | `log/outputlog.jsonl` | one JSON object per session event, tagged `story`, `agentName`, `iteration` |
| which tool calls errored | `log/outputlog.jsonl` | `tool_execution_end` with `isError: true` |
| tool failure rate per role | `scripts/backtrackReport.ts` | backtrack rate, failures by tool |
| across repeat runs | experiment report | `stability` block: `completionRate`, `outcomeAgreement`, `outcomes` (a run with no summary counts as `no_summary`, so agreement cannot be claimed over an empty tally), per-run spread of tested ratio and test score |
| across historical runs | `scripts/reclassifyRuns.ts` | recomputes failure classes over every summary under `output/` |

Note the deliberate split between **pooled** aggregates and the **stability**
block: a variant's pooled tested-story ratio can look healthy while one repeat
did half the work. A variant is only as good as its worst repeat. The block
needs `repeat` above 1 to say anything: at `repeat: 1` agreement is trivially
true and every spread is zero.

The jsonl log excludes streaming deltas but keeps everything else, so it is the
place to reconstruct exactly which tool call was refused and why: a refusal
appears as the tool result text, since both the sandbox and the scope guard
report their reason back to the model rather than failing silently.

---

## 6. Known gaps

Things the architecture currently cannot express or cannot see. Listed so a
reviewer proposes against the real boundary rather than rediscovering it.

**Cannot express:**

- per-role model, thinking level, or sampling. All model configuration is
  run-global.
- replanning. A bad story list is fixed at stage 2 forever; there is no path
  back to the product owner. Note the corpus says plan *validity* is not the
  problem (1 of 69 runs failed as `planning`), plan *shape* is: the `plan` block
  now measures it, and the replanning question should wait on what it shows.
- parallel story execution. Ready stories run sequentially. This is listed for
  completeness only: no plan in the corpus has ever contained two independent
  stories, so the scheduler is not what constrains it.
- partial credit on a story. A story is terminal or blocked; there is no
  "shipped with known findings".
- cross-run learning. `AGENTS.md` is seeded empty every run, so the same
  environment lesson is rediscovered every time.
- feeding the guide's `RUN:` command back as a verification step.

**Cannot see:**

- **per-story and per-iteration cost.** `agents.<role>` buckets tokens and wall
  clock by role for the whole run, so what a rework iteration costs, or what a
  blocked story cost, cannot be recovered. Given that iteration 4 yields 3
  successes against 20 blocks in the corpus, this is the most valuable of the
  blind spots and the cheapest to close: `attach()` already has both `storyId`
  and `iteration` in scope.
- prompt token composition. `inputTokens` is a total, so the split between
  system prompt, `AGENTS.md`, tool schemas, and conversation regrowth is not
  measurable from the summary alone.
- ground truth on output quality. The tester's score is the only quality signal,
  it is produced by the same model family being evaluated, and in practice it is
  binary (see §3.3). There are no reference fixtures.
- tool-selection accuracy. `backtrackRate` counts calls that errored, not calls
  that were the wrong choice but succeeded.
- whether a rework iteration actually addressed the finding it was given.
  `reviewTrajectory` shows the score moved, not why. Verdicts are a single
  mutable field per gate, so no iteration-by-iteration finding history exists
  and the reviewer's self-agreement on unchanged code cannot be computed.
- whether reasoning tokens are double counted. `summaryCollector` adds
  `message.usage.reasoning` on `message_end` **and** an estimate from each
  `thinking_delta`. The corpus shows the product owner at a reasoning/output
  ratio above 1, consistent with either double counting or a separate reasoning
  channel. Unresolved, and worth settling before any reasoning figure is cited.

---

## 7. Reading a run: worked order

For an agent handed a failing run and this document:

1. `summary.json` → `outcome` and `failureMode`. Section 4 maps it to a stage.
2. `stories[]` → which stories are `blocked` vs `skippedByDependency`. Skipped
   stories are collateral; find the story that actually blocked.
3. That story's `blockedReason`, `silentGates`, `gateRetries`,
   `reviewTrajectory`, `testTrajectory`. A flat trajectory means the gate kept
   finding the same thing; an absent one means no verdict was ever persisted,
   which covers both a gate that never spoke and one whose every write was
   refused. The jsonl tells those apart.
4. `agents.<role>` → `timedOutInvocations`, `longestToolCallMs`,
   `rejectedToolCalls` and `sandboxDenials` over `executedToolCalls`. This
   separates "the model could not do it" from "the harness got in its way".
   Read both waste counters: they measure different channels, and the sandbox
   one has historically been the larger.
5. `log/outputlog.jsonl` filtered to that story and that agent → the actual
   sequence, including the text of every refusal.
6. Section 3 → pick the lever belonging to the stage found in step 1, at the
   narrowest scope that fixes it: field allowlist before tool allowlist, tool
   allowlist before prompt text, prompt text before a code change.
