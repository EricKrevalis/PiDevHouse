# Large request reliability research (01.09)

Source observations describe the current dirty worktree on 1 September 2026. Experiment claims describe the exact variants recorded in their reports and are not assumed to match committed source.

## Executive finding

The repository does not mainly fail large requests because the four prompts are too weak. It fails because story failure is also run failure, progress cannot be resumed after a process loss, dependency plans are trusted without graph validation, and completion is judged one story at a time against model-written criteria.

Reliability compounds across stories. Even if each story had an independent 90% chance of passing, a ten-story request would have only a 35% chance of finishing in one uninterrupted pass. Larger plans therefore need checkpointed recovery, not merely better first attempts.

The strongest current evidence is the 12,604-second recipe-vault run. Story 1 passed, story 2 exhausted three developer and reviewer cycles, and stories 3 and 4 remained `todo`. Two smaller runs also ended at `max_iterations` after reviewer or tester drift. Tool execution was less than 2.5% of wall time in one measured run, and no agent reached the 100-call budget [experiment 12, lines 3-15, 22-31](experiment-12-findings-01.09.md#L3-L31). More prompt text or larger budgets would leave the loss boundary unchanged.

The smallest high-impact change is to contain `incomplete` and `max_iterations` at story level. Mark that story with the existing terminal `blocked` state, continue to the next independent ready story, and return a non-successful run only after no more progress is possible. Keep `infrastructure`, cancellation, timeout, and unexpected exceptions as run interruptions. This change banks useful work and directly tests the dominant recent failure without introducing a new service or framework. It improves partial completion, not strict request completion by itself.

Strict completion needs durable resume and a later recovery pass for blocked work. The repository already writes story state and developer commits, but a new process never loads that state. A small local checkpoint is enough at this scale. Temporal's design is useful evidence for the semantics, not a reason to add Temporal as a dependency.

## Current flow end to end

1. `run()` creates or prepares a workspace, creates a `StoryRepository` whose active state lives in memory and whose updates are mirrored to JSON, starts logging, runs a model-server preflight, and invokes the product owner [packages/core/src/runtime/workflow.ts:25-71](../../packages/core/src/runtime/workflow.ts#L25-L71), [packages/core/src/modules/repository/story.repository.ts:10-22,78-84](../../packages/core/src/modules/repository/story.repository.ts#L10-L84).
2. The product owner must submit a complete replacement plan through `create_stories`. If no stories exist, the same product-owner prompt is retried once [packages/core/src/runtime/workflow.ts:56-84](../../packages/core/src/runtime/workflow.ts#L56-L84), [packages/core/src/modules/agents/po/po.agent.ts:22-40](../../packages/core/src/modules/agents/po/po.agent.ts#L22-L40).
3. The scheduler chooses the lowest-ID `todo` story whose `blockedBy` stories are all `tested` [packages/core/src/modules/repository/story.repository.ts:32-43](../../packages/core/src/modules/repository/story.repository.ts#L32-L43).
4. Each story gets up to `maxIteration`, currently three, of developer, reviewer, and tester work. A missing final status or validation result gets one same-session nudge. A low review or test score restarts the entire developer-review-test cycle [packages/core/src/runtime/storyLoop.ts:49-119](../../packages/core/src/runtime/storyLoop.ts#L49-L119), [packages/core/src/modules/models/config.model.ts:12-17](../../packages/core/src/modules/models/config.model.ts#L12-L17).
5. Any story outcome other than `completed` sets the run outcome and breaks the scheduler loop. One failed story therefore forfeits every later story, including independent ready stories [packages/core/src/runtime/workflow.ts:92-112](../../packages/core/src/runtime/workflow.ts#L92-L112).
6. The final summary records outcomes, aggregate agent usage, story status, scores, and the highest observed iteration [packages/core/src/modules/services/summaryCollector.ts:188-209](../../packages/core/src/modules/services/summaryCollector.ts#L188-L209).

The implemented story state machine is:

```text
todo -> in_progress -> implemented -> approved -> tested
                         |              |
                         +-> in_progress <-+

blocked is terminal but unreachable
```

The model owns the normal transitions through tools. The repository rejects illegal transitions, but `blocked` has no incoming transition and nothing sets it [packages/core/src/modules/models/story.model.ts:3-24](../../packages/core/src/modules/models/story.model.ts#L3-L24), [packages/core/src/modules/tools/storys/updateStoryStatus.ts:20-45](../../packages/core/src/modules/tools/storys/updateStoryStatus.ts#L20-L45).

## Failure modes by level

| Failure class | Actual mechanism | Current consequence | Evidence |
| --- | --- | --- | --- |
| Story-level failure | The developer does not reach `implemented`, a validator does not record a fresh result, a validator records a low score, or the story exhausts its iteration count. Low scores replay the full three-agent cycle. | `incomplete`, `infrastructure`, or `max_iterations` leaves the story unfinished. There is no terminal failed state carrying a cause. | [packages/core/src/runtime/storyLoop.ts:81-119](../../packages/core/src/runtime/storyLoop.ts#L81-L119); experiment 12 observed three `max_iterations` outcomes [lines 9-15](experiment-12-findings-01.09.md#L9-L15). |
| Run-level failure | `workflow.ts` breaks on every non-completed story outcome. `run()` returns true only when the final run outcome is `completed`. | Tested work remains on disk, but independent later work is never attempted and the caller receives failure for the whole request. | [packages/core/src/runtime/workflow.ts:92-145](../../packages/core/src/runtime/workflow.ts#L92-L145); experiment 6 lost two ready stories after one tester omitted a result [lines 23-35](experiment-6-findings-31.08.md#L23-L35). |
| Infrastructure failure | Any uncaught agent, filesystem, sandbox, model, or preflight error escapes `run()` after summary writing. Tester score `-1` also stops the run. The model retry policy permits two retries, and one specific message-role race gets one retry, but no failed stage is resumed in a new session. | A transient stage failure can forfeit the run. The default config has no overall timeout. A hard process kill may prevent the final summary write. | [packages/core/src/modules/models/agent.model.ts:94-127,164-181](../../packages/core/src/modules/models/agent.model.ts#L94-L127), [packages/core/src/runtime/workflow.ts:113-143](../../packages/core/src/runtime/workflow.ts#L113-L143), [packages/core/src/modules/models/config.model.ts:4-17](../../packages/core/src/modules/models/config.model.ts#L4-L17). |
| Evaluation drift | Reviewer and tester each write a range-unconstrained numeric score and free-text note. The schema has no criterion-level verdict or evidence field. The workflow passes the same configured model provider to all three roles. Passing is delegated to model-written score and status calls. | A moving or inconsistent judgment triggers another expensive implementation cycle. Conversely, decomposition omissions can pass because there is no final request-level coverage or integration gate. | [packages/core/src/modules/models/story.model.ts:26-41](../../packages/core/src/modules/models/story.model.ts#L26-L41), [packages/core/src/modules/tools/storys/updateValidationResult.ts:15-40](../../packages/core/src/modules/tools/storys/updateValidationResult.ts#L15-L40), [packages/core/src/runtime/storyLoop.ts:30-47](../../packages/core/src/runtime/storyLoop.ts#L30-L47); experiment 12 attributes two failures to evaluator or specification drift [lines 15, 31, 38](experiment-12-findings-01.09.md#L15-L38). |
| Dependency planning failure | `create_stories` rejects duplicate IDs but does not reject missing dependencies, self-dependencies, forward references, or cycles. Readiness treats a missing dependency as not tested. The prompt is the only graph constraint. | A malformed plan reaches `no_ready` with no diagnostic or repair path. A failed prerequisite also strands every dependent `todo` story. | [packages/core/src/modules/tools/storys/createStories.ts:9-47](../../packages/core/src/modules/tools/storys/createStories.ts#L9-L47), [packages/core/src/modules/repository/story.repository.ts:32-43](../../packages/core/src/modules/repository/story.repository.ts#L32-L43), [packages/core/src/runtime/workflow.ts:92-97](../../packages/core/src/runtime/workflow.ts#L92-L97). Recent reports do not establish its frequency, so this needs an injected-plan experiment. |
| Context growth | Sessions are in memory. Compaction is enabled globally, while the tester disables compaction and deterministically elides stale tool results. Sessions are fresh for each agent and iteration except for the one finalization nudge. | Large individual stories can compact or rediscover context on rework. Request length itself does not create one ever-growing conversation because stories and roles get fresh sessions. | [packages/core/src/modules/models/agent.model.ts:75-127](../../packages/core/src/modules/models/agent.model.ts#L75-L127), [packages/core/src/modules/agents/tester/tester.agent.ts:53-59](../../packages/core/src/modules/agents/tester/tester.agent.ts#L53-L59), [packages/core/src/modules/tools/evict.ts:37-79](../../packages/core/src/modules/tools/evict.ts#L37-L79). Experiment 12 saw 22 compactions but no context blowup; the largest observed input was 19,542 tokens [lines 25-27, 39, 50](experiment-12-findings-01.09.md#L25-L50). |
| Serial execution cost | The scheduler selects one ready story, then awaits its developer, reviewer, and tester before selecting another. Independent graph branches are not used for concurrency. | Wall time is the sum of all model turns and rework. Long exposure increases the chance that one late failure discards hours of remaining work. | [packages/core/src/runtime/workflow.ts:92-112](../../packages/core/src/runtime/workflow.ts#L92-L112). The recipe-vault loss took 3:30:04; identical small tasks varied by 2.4 times [experiment 12, lines 9-15, 31](experiment-12-findings-01.09.md#L9-L31). |

## What the prompts do and cannot do

The product-owner prompt now asks for stories that one developer can complete in one iteration, limits each story to four criteria, and asks for independent vertical slices [packages/core/src/modules/agents/po/poPrompt.md:1-18](../../packages/core/src/modules/agents/po/poPrompt.md#L1-L18). This directly addresses the experiment-4 finding that an oversized recipe story exceeded 75 tool calls [experiment 4, lines 25-31](experiment-4-findings-28.08.md#L25-L31). The current 100-call budget was not reached in experiment 12, so the revised sizing prompt needs a controlled rerun rather than another budget increase.

The developer prompt prioritizes prior findings and requires checks before `implemented` [packages/core/src/modules/agents/developer/developerPrompt.md:1-12](../../packages/core/src/modules/agents/developer/developerPrompt.md#L1-L12). The reviewer treats the criteria as a fixed contract. The reviewer and tester require a result every run and reserve passing status for a passing evaluation [packages/core/src/modules/agents/reviewer/reviewerPrompt.md:1-12](../../packages/core/src/modules/agents/reviewer/reviewerPrompt.md#L1-L12), [packages/core/src/modules/agents/tester/testerPrompt.md:1-10](../../packages/core/src/modules/agents/tester/testerPrompt.md#L1-L10).

Prompt changes can improve story sizing, tool use, and evaluator attention. They cannot:

- continue after a story-level loss;
- load a checkpoint after a worker crash;
- reject an invalid dependency graph;
- make score updates criterion-complete;
- distinguish transient infrastructure faults from product defects;
- prove that the product owner's criteria cover the original request.

The experiment record also warns against treating a prompt instruction as a hard control. Agents have ended without required result calls, malformed plans appeared in earlier runs, and evaluator drift recurred after prompt refinements [f06 findings, lines 7-15](f06-findings-26.08.md#L7-L15), [experiment 12, lines 29-40](experiment-12-findings-01.09.md#L29-L40). Prompt work is useful, but not sufficient.

## Relevant external evidence

Durable workflow systems persist state transitions and resume from the latest recorded event after failures. Temporal documents this event-history and replay model directly [Temporal durable execution](https://docs.temporal.io/temporal#durable-execution), [Temporal workflow replay](https://docs.temporal.io/workflow-execution#replays). This repository does not need Temporal yet. It does need the same basic boundary: persist a confirmed stage before starting the next failure-prone activity.

Retries should target failure-prone activities, not restart the whole workflow. Temporal distinguishes retryable activities from workflow logic, recommends idempotent writes because an activity can execute more than once, and notes that smaller activities avoid replaying already-successful side effects [Temporal retry policies](https://docs.temporal.io/encyclopedia/retry-policies), [Temporal activity idempotency](https://docs.temporal.io/activity-definition#idempotency). AWS gives the same practical rule: a caller-provided request identifier makes duplicate requests auditable and safe [AWS, Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).

Dependency schedulers model task order and failure propagation explicitly. Airflow runs a task only when its upstream conditions are met and represents failed and upstream-failed states separately [Airflow DAG dependencies and trigger rules](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html#trigger-rules). The repository currently has dependency edges but no graph validation and no reachable failed or upstream-blocked state.

Long context is not reliable memory by itself. The original Lost in the Middle experiments found that model accuracy can fall when relevant information sits in the middle of a long context, including for long-context models [Liu et al., 2023](https://arxiv.org/abs/2307.03172). Anthropic's long-running coding harness instead uses a structured feature list, git history, incremental sessions, and explicit progress artifacts; it reports that compaction alone was insufficient [Anthropic, Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). The repository already has stories and git commits. Loading and reconciling them after restart is the missing step.

Agent evaluation should prefer observable outcomes and deterministic checks where possible. Anthropic recommends code-based graders for coding outcomes, multiple trials because agent behavior varies, and grading the result rather than requiring one exact trajectory [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents). OpenAI recommends task-specific evals, automated scoring where possible, human calibration, and pass/fail or criterion-specific grading over unconstrained open-ended judgment [OpenAI evaluation best practices](https://platform.openai.com/docs/guides/evaluation-best-practices). These sources support replacing the free numeric score as the primary gate, not adding more prose to the judge prompt.

Parallel work is appropriate only for independent subtasks. Anthropic describes sectioning independent work and aggregating it programmatically, while also warning that agentic systems trade latency and cost for performance [Anthropic, Building effective agents](https://www.anthropic.com/research/building-effective-agents#workflow-parallelization). In this repository, developers share one working tree and create commits. Parallel developer sessions would conflict unless isolation and merge semantics are added first.

## Ranked recommendations

| Rank | Change | Likely completion impact | Implementation cost | Evidence status |
| --- | --- | --- | --- | --- |
| 1 | Contain story failure. On `incomplete` or `max_iterations`, move the current story to `blocked`, record the reason, and continue selecting ready stories. Do not continue on infrastructure or process errors. End `completed` only if all stories tested; otherwise end `incomplete` after no ready work remains. | Very high for useful completion, low for strict completion until recovery exists. It converts the repeatedly observed first-story or second-story run loss into partial progress and may still complete independent branches. | Low. State transitions, workflow branch, summary reason, and focused tests. | Supported by experiments 6 and 12. |
| 2 | Resume from persisted stage. Load and validate `stories.json`, persist a small run manifest atomically, and start at the first unfinished stage rather than rerunning the product owner and developer unconditionally. | High for long runs. Process, model-server, and timeout interruptions no longer discard confirmed stages. | Medium. Requires recovery rules and idempotent stage boundaries, but no new service. | Strong external support. Repository crash evidence exists, but resume behavior needs fault-injection tests. |
| 3 | Replace score-first evaluation with criterion verdicts. Require one pass, fail, or unverifiable result plus evidence per acceptance criterion. Let the harness derive pass or fail. Keep free text for findings, not gating. Add one final request-level integration and coverage check after all runnable stories finish. | High if evaluator drift and decomposition omissions remain. It prevents one arbitrary number from driving a full rework cycle and catches cross-story gaps. | Medium. Story schema, tools, prompts, summary, and migration of test fixtures. | Story-level drift is supported by experiment 12. The final request gate needs an experiment because current reports do not measure omission rate. |
| 4 | Validate the dependency plan in `create_stories`. Reject unknown IDs, self edges, forward edges if build order remains the contract, and cycles. Return the exact bad edge so the existing product-owner retry can repair it. | Medium. Prevents deterministic `no_ready` runs before implementation starts. | Low. One graph check at the trust boundary and one test. | Source-supported risk. Frequency is not established, so inject malformed plans before claiming a measured gain. |
| 5 | Classify and bound stage retries. Retry transient model and browser infrastructure failures in a fresh session with backoff; do not retry invalid plans, failed deterministic tests, or exhausted product rework. Persist attempt count and last error. | Medium. Recovers transient faults without repeating the whole run or hiding permanent failures. | Medium. Needs an error taxonomy and stage attempt state. | External support plus prior infrastructure failures. Exact retry counts need measurement. |
| 6 | Keep contexts bounded with structured state. Extend deterministic stale-result eviction only if measurements show developer or product-owner compaction causes losses. Put current story, criteria, findings, and stage near the start of each fresh prompt. | Low to medium for completion, medium for speed. Current context pressure is contained in the latest experiment. | Low to medium. | Experiment 12 says watch, not act. Run an eviction A/B before broadening it. |
| 7 | Add concurrency after recovery is correct. First parallelize read-only evaluations or isolated independent stories in separate worktrees, with per-story concurrency keys and a deterministic merge step. | Mainly speed. Shorter exposure may indirectly improve completion, but concurrency also creates conflict and load failures. | High. | Needs an experiment. Do not parallelize developers in the shared working tree. |

## Required state and recovery behavior

A minimal durable design can stay file-backed:

```text
run: planning -> running -> completed
                     |  -> incomplete
                     |  -> interrupted -> running
                     +  -> cancelled

story: todo -> in_progress -> implemented -> approved -> tested
          |         |              |            |
          +---------+--------------+------------+-> blocked
```

For the first containment change, `blocked` means this run will not spend more attempts on the story. Its persisted note should identify `developer_incomplete`, `review_incomplete`, `test_incomplete`, or `max_iterations`. Dependent stories remain unrunnable, while unrelated ready stories continue. A later schema can split `failed` from `upstream_blocked` if users need that distinction.

For restartability, persist `{runId, requestHash, phase, currentStoryId, currentStage, attempt, lastError}` with the stories. Write a temporary file and rename it so readers see the previous or next complete checkpoint rather than a partially written target. Recovery should be deterministic:

| Persisted state | Resume action |
| --- | --- |
| No accepted plan | Run the product owner. Do not overwrite an existing accepted plan on retry. |
| `todo` | Start the developer. |
| `in_progress` | Reopen the developer in a fresh session, inspect the working tree and last commit, and finish or block the same story. |
| `implemented` | Run the reviewer without rerunning the developer. |
| `approved` | Run the tester without rerunning developer or reviewer. |
| `tested` | Skip the story. |
| `blocked` | Skip it and continue with independent ready stories. |
| Interrupted infrastructure stage | Retry the same stage with the same `{runId, storyId, stage, attempt}` identity until its bounded retry policy expires. |

The existing control writes are close to idempotent: same-status updates are accepted and validation results overwrite one field [packages/core/src/modules/repository/story.repository.ts:45-75](../../packages/core/src/modules/repository/story.repository.ts#L45-L75). `create_stories` is not safe for resume because it replaces the complete plan [packages/core/src/modules/repository/story.repository.ts:19-22](../../packages/core/src/modules/repository/story.repository.ts#L19-L22). Developer commits also need reconciliation on restart so the resumed agent does not create an empty or duplicate iteration commit.

## Smallest next implementation

Implement only story-failure containment first:

1. Allow `todo`, `in_progress`, `implemented`, and `approved` to transition to the existing `blocked` status.
2. Have `runStory()` return a reason detailed enough to distinguish product failure from infrastructure interruption.
3. In `workflow.ts`, mark `incomplete` and `max_iterations` stories `blocked` and continue. Preserve immediate stop for `infrastructure`, timeout, cancellation, and exceptions.
4. When no ready story remains, return `incomplete` if any story is blocked or still todo. Keep `no_ready` for an invalid plan with no failed prerequisite.
5. Add one deterministic test with three stories: story 1 fails, story 2 depends on story 1, and independent story 3 completes. Assert that story 1 is blocked, story 2 remains todo, story 3 is tested, and the run is incomplete.

This is intentionally smaller than durable orchestration. It attacks the measured forfeiture first and creates the terminal state that resume logic will later need. Containment alone will not make a required failed story pass, so it raises useful completion rather than strict request completion until restart and reattempt exist.

## Measurement plan

### Correctness checks

- Unit-test legal terminal transitions, continuation to an independent story, and immediate stop on infrastructure failure.
- Inject missing, self, and cyclic dependencies into `create_stories` when recommendation 4 is implemented.
- For resume work, terminate the worker once during each of `in_progress`, `implemented`, and `approved`, then assert that restart begins at the documented stage and does not duplicate completed work.

### Controlled agent experiment

Run the current baseline and containment variant with the same commit, prompts, model, server configuration, and task order. Interleave variants to reduce server-state bias. Use three trials per variant for the multi-hour recipe task and at least five for the small task if runtime permits. Add a synthetic request with one intentionally hard story followed by an independent easy story. Do not compare only each variant's best run.

Primary metrics:

- strict request completion rate, all required stories tested;
- useful completion ratio, tested stories divided by all planned stories;
- ready-story coverage, ready stories attempted divided by ready stories available;
- run-loss rate by the seven failure classes in this report;
- wall time, input tokens, model calls, and tool calls per tested story;
- reviewer and tester criterion disagreement after criterion-level results exist.

Report both per-trial success and consistency across repeated trials. Agent output varies, so one successful run is not reliability evidence. Keep transcript review in the loop to distinguish product defects, grader mistakes, and infrastructure failures, as recommended by Anthropic's agent eval guidance [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents#how-to-think-about-non-determinism-in-evaluations-for-agents).

Success for the first change is not merely a higher partial-completion number. It must show that later independent stories run after an earlier story fails, infrastructure failures still stop safely, total spend per tested story does not regress materially, and strict completion does not fall on the small task.

## What not to do

- Do not raise `maxIteration` or `maxToolCalls` again. Experiment 12 observed at most 72 of 100 calls, while the longest failed run spent three full cycles on one story [experiment 12, lines 22, 31, 37](experiment-12-findings-01.09.md#L22-L37).
- Do not treat another prompt rewrite as the reliability fix. The current prompts already state sizing, fixed criteria, required result calls, and completion conditions. Code still makes one story stop the run.
- Do not increase the context window or output cap without a measured overflow. The latest experiment saw no output-limit hit and no context blowup [experiment 12, lines 21-27, 50](experiment-12-findings-01.09.md#L21-L50).
- Do not optimize tool execution first. Measured tool time was noise beside model prefill and generation [experiment 12, lines 31, 47](experiment-12-findings-01.09.md#L31-L47).
- Do not add more reviewer votes by default. More model judges multiply serial cost and can share the same bias. First make each criterion observable and calibrate model judgments against deterministic checks or human review.
- Do not parallelize developer agents in the same working tree. Git commits and edits will race. Add isolation, merge rules, and recovery before concurrency.
- Do not adopt Temporal, Airflow, or another workflow platform for the first fix. The local workflow has one process and a small state model. Borrow durable state, idempotency, and retry semantics; add a platform only when multiple workers, remote queues, or operational recovery requirements make the local checkpoint inadequate.

## Conclusion

Large-request reliability will improve most by changing where failure stops progress. The current architecture has useful pieces already: bounded story loops, explicit status tools, dependency edges, persisted story JSON, git commits, summaries, and context controls. The missing behavior is mechanical. A failed story should not erase the opportunity to complete independent work, and a failed process should not erase confirmed stages.

Implement story containment first and measure it. Then make the same state resumable. Prompt refinements and evaluator improvements matter, but they cannot substitute for those two guarantees.
