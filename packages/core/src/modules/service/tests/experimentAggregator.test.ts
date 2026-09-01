import assert from "node:assert/strict";
import { it } from "vitest";
import type { AgentUsage, OutcomeClass, Summary } from "../../model/summary.model.ts";
import type { StoryStatus } from "../../model/story.model.ts";
import {
  aggregateExperimentResults,
  type ExperimentRunResult,
} from "../experimentAggregator.ts";

function usage(
  calls: number,
  inputTokens: number,
  outputTokens: number,
  timing?: {
    totalDurationMs: number;
    invocations: number;
    timedOutInvocations?: number;
    longestToolCallMs?: number;
  },
): AgentUsage {
  return {
    calls,
    inputTokens,
    outputTokens,
    reasoningTokens: 0,
    totalDurationMs: timing?.totalDurationMs ?? 0,
    invocations: timing?.invocations ?? 0,
    timedOutInvocations: timing?.timedOutInvocations ?? 0,
    longestInvocationMs: 0,
    longestToolCallMs: timing?.longestToolCallMs ?? 0,
    rejectedToolCalls: 0,
    executedToolCalls: calls,
    sandboxDenials: 0,
  };
}

function story(id: number, status: StoryStatus): Summary["stories"][number] {
  return { id, title: `story ${id}`, status, iterations: 1 };
}

function summary(overrides: {
  durationSeconds: number;
  outcome?: OutcomeClass;
  agents: Record<string, AgentUsage>;
  stories: Summary["stories"];
}): Summary {
  return {
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    durationSeconds: overrides.durationSeconds,
    request: "req",
    outcome: overrides.outcome ?? "completed",
    failureMode: "none",
    exitCode: 0,
    model: "test",
    config: {},
    environment: {
      thinkingLevel: "low",
      contextWindow: 65_536,
      maxTokens: 16_384,
      ollamaHost: "http://localhost:11434",
    },
    agents: overrides.agents,
    stories: overrides.stories,
  };
}

function run(
  variantIndex: number,
  exitCode: number,
  s: Summary | null,
): ExperimentRunResult {
  return { variantIndex, exitCode, summary: s };
}

it("computes stats, ratios and per-story cost on a known input", () => {
  const results: ExperimentRunResult[] = [
    run(
      1,
      0,
      summary({
        durationSeconds: 10,
        agents: { a: usage(2, 100, 50) },
        stories: [
          story(1, "tested"),
          story(2, "tested"),
          story(3, "todo"),
          story(4, "blocked"),
        ],
      }),
    ),
    run(
      1,
      0,
      summary({
        durationSeconds: 20,
        agents: { a: usage(4, 200, 100) },
        stories: [story(1, "tested"), story(2, "todo")],
      }),
    ),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.equal(aggregate.variantIndex, 1);
  assert.equal(aggregate.runCount, 2);
  assert.equal(aggregate.failureCount, 0);
  assert.equal(aggregate.failureRate, 0);

  assert.deepEqual(aggregate.durationSeconds, {
    mean: 15,
    stddev: 5,
    min: 10,
    max: 20,
  });
  // tokens per run: 100+50=150, 200+100=300
  assert.deepEqual(aggregate.totalTokens, {
    mean: 225,
    stddev: 75,
    min: 150,
    max: 300,
  });
  assert.deepEqual(aggregate.totalCalls, {
    mean: 3,
    stddev: 1,
    min: 2,
    max: 4,
  });
  // tested 2+1 of 4+2 total
  assert.equal(aggregate.testedStoryRatio, 0.5);
  // calls 2+4 over stories 4+2
  assert.equal(aggregate.callsPerStory, 1);
});

it("averages agent duration per invocation across runs", () => {
  const results: ExperimentRunResult[] = [
    // run 1: 600ms over 3 invocations -> 200ms/invocation
    run(
      1,
      0,
      summary({
        durationSeconds: 10,
        agents: {
          a: usage(2, 100, 50, { totalDurationMs: 400, invocations: 2 }),
          b: usage(1, 50, 25, { totalDurationMs: 200, invocations: 1 }),
        },
        stories: [story(1, "tested")],
      }),
    ),
    // run 2: 800ms over 2 invocations -> 400ms/invocation
    run(
      1,
      0,
      summary({
        durationSeconds: 20,
        agents: { a: usage(2, 100, 50, { totalDurationMs: 800, invocations: 2 }) },
        stories: [story(1, "tested")],
      }),
    ),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.deepEqual(aggregate.durationPerInvocationMs, {
    mean: 300,
    stddev: 100,
    min: 200,
    max: 400,
  });
});

it("treats a run with zero invocations as 0 duration/invocation, not NaN", () => {
  const results: ExperimentRunResult[] = [
    run(
      1,
      0,
      summary({
        durationSeconds: 10,
        agents: { a: usage(1, 10, 10) },
        stories: [story(1, "tested")],
      }),
    ),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.equal(aggregate.durationPerInvocationMs.mean, 0);
  assert.ok(!Number.isNaN(aggregate.durationPerInvocationMs.mean ?? NaN));
});

it("keeps variants separated and sorted by variantIndex", () => {
  const results: ExperimentRunResult[] = [
    run(2, 0, summary({ durationSeconds: 30, agents: { a: usage(1, 10, 10) }, stories: [story(1, "tested")] })),
    run(1, 0, summary({ durationSeconds: 10, agents: { a: usage(1, 10, 10) }, stories: [story(1, "todo")] })),
    run(2, 0, summary({ durationSeconds: 50, agents: { a: usage(1, 10, 10) }, stories: [story(1, "tested")] })),
  ];

  const aggregates = aggregateExperimentResults(results);

  assert.equal(aggregates.length, 2);
  assert.deepEqual(
    aggregates.map((a) => a.variantIndex),
    [1, 2],
  );
  assert.equal(aggregates[0].runCount, 1);
  assert.equal(aggregates[1].runCount, 2);
  assert.equal(aggregates[1].durationSeconds.mean, 40);
});

it("gives a single-run variant stddev 0", () => {
  const results: ExperimentRunResult[] = [
    run(1, 0, summary({ durationSeconds: 42, agents: { a: usage(3, 100, 100) }, stories: [story(1, "tested")] })),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.equal(aggregate.durationSeconds.mean, 42);
  assert.equal(aggregate.durationSeconds.stddev, 0);
  assert.equal(aggregate.durationSeconds.min, 42);
  assert.equal(aggregate.durationSeconds.max, 42);
});

it("counts a variant with no summaries as all failures with null stats", () => {
  const results: ExperimentRunResult[] = [
    run(1, 1, null),
    run(1, 1, null),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.equal(aggregate.runCount, 2);
  assert.equal(aggregate.failureCount, 2);
  assert.equal(aggregate.failureRate, 1);
  assert.deepEqual(aggregate.durationSeconds, {
    mean: null,
    stddev: null,
    min: null,
    max: null,
  });
  assert.deepEqual(aggregate.totalTokens, {
    mean: null,
    stddev: null,
    min: null,
    max: null,
  });
  assert.equal(aggregate.testedStoryRatio, 0);
  assert.equal(aggregate.callsPerStory, 0);
});

it("excludes an infrastructure failure from the comparable stats", () => {
  const results: ExperimentRunResult[] = [
    run(1, 0, summary({ durationSeconds: 10, agents: { a: usage(1, 10, 10) }, stories: [story(1, "tested")] })),
    run(
      1,
      0,
      summary({
        durationSeconds: 30,
        outcome: "error",
        agents: { a: usage(3, 10, 10) },
        stories: [story(1, "todo")],
      }),
    ),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.equal(aggregate.failureCount, 1);
  assert.equal(aggregate.failureRate, 0.5);
  // the failure is the provider, not the model, so it must not count against it
  assert.equal(aggregate.infraFailureCount, 1);
  assert.equal(aggregate.modelFailureCount, 0);
  assert.equal(aggregate.modelFailureRate, 0);
  assert.equal(aggregate.validRunCount, 1);
  assert.deepEqual(aggregate.failureClasses, { provider: 1 });
  // and its 30s must not inflate the variant's mean duration
  assert.equal(aggregate.durationSeconds.mean, 10);
  assert.equal(aggregate.totalCalls.mean, 1);
  assert.equal(aggregate.testedStoryRatio, 0.5);
});

it("counts a hung tool call as infrastructure and a budget overrun as model", () => {
  const results: ExperimentRunResult[] = [
    run(
      1,
      1,
      summary({
        durationSeconds: 900,
        outcome: "incomplete",
        // a command at the bash timeout held the invocation
        agents: {
          a: usage(3, 10, 10, {
            totalDurationMs: 1_200_000,
            invocations: 1,
            timedOutInvocations: 1,
            longestToolCallMs: 983_000,
          }),
        },
        stories: [story(1, "blocked")],
      }),
    ),
    run(
      1,
      1,
      summary({
        durationSeconds: 900,
        outcome: "incomplete",
        // same overrun, no hung command: the time went into the model
        agents: {
          a: usage(3, 10, 10, {
            totalDurationMs: 1_200_000,
            invocations: 1,
            timedOutInvocations: 1,
          }),
        },
        stories: [story(1, "blocked")],
      }),
    ),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.equal(aggregate.infraFailureCount, 1);
  assert.equal(aggregate.modelFailureCount, 1);
  assert.equal(aggregate.validRunCount, 1);
  assert.deepEqual(aggregate.failureClasses, { tool_hang: 1, agent_timeout: 1 });
});

it("returns an empty array for empty input without throwing", () => {
  assert.deepEqual(aggregateExperimentResults([]), []);
});

it("reports repeats that disagree as unstable even when one run is clean", () => {
  const results: ExperimentRunResult[] = [
    run(
      1,
      0,
      summary({
        durationSeconds: 10,
        agents: { a: usage(4, 100, 50) },
        stories: [story(1, "tested"), story(2, "tested")],
      }),
    ),
    run(
      1,
      1,
      summary({
        durationSeconds: 20,
        outcome: "incomplete",
        agents: { a: usage(4, 100, 50) },
        stories: [story(1, "tested"), story(2, "blocked")],
      }),
    ),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.equal(aggregate.stability.completionRate, 0.5);
  assert.equal(aggregate.stability.outcomeAgreement, false);
  assert.deepEqual(aggregate.stability.outcomes, {
    completed: 1,
    incomplete: 1,
  });
  // the pooled ratio is 0.75, which hides that one repeat did half the work.
  assert.equal(aggregate.testedStoryRatio, 0.75);
  assert.equal(aggregate.stability.testedStoryRatioPerRun.min, 0.5);
  assert.equal(aggregate.stability.testedStoryRatioPerRun.max, 1);
});

it("counts refused tool calls and never-attempted stories", () => {
  const rejecting = usage(6, 100, 50);
  rejecting.rejectedToolCalls = 2;
  const results: ExperimentRunResult[] = [
    run(
      1,
      1,
      summary({
        durationSeconds: 10,
        outcome: "incomplete",
        agents: { a: rejecting },
        stories: [
          story(1, "blocked"),
          { ...story(2, "todo"), skippedByDependency: true },
        ],
      }),
    ),
  ];

  const [aggregate] = aggregateExperimentResults(results);

  assert.equal(aggregate.rejectedCallRatio, 2 / 8);
  assert.equal(aggregate.skippedStoryRatio, 0.5);
});

it("rates refused calls against tool calls, not assistant turns", () => {
  // usage.calls counts assistant messages. using it as the denominator made the
  // ratio turns-plus-rejections, which is not a rate of anything.
  const busy = usage(3, 100, 50);
  busy.executedToolCalls = 17;
  busy.rejectedToolCalls = 3;
  busy.sandboxDenials = 4;
  const [aggregate] = aggregateExperimentResults([
    run(1, 0, summary({
      durationSeconds: 10,
      agents: { a: busy },
      stories: [story(1, "tested")],
    })),
  ]);

  assert.equal(aggregate.rejectedCallRatio, 3 / 20);
  // denials execute as tool calls, so they are a share of what ran
  assert.equal(aggregate.sandboxDenialRatio, 4 / 17);
});

it("does not let a never-attempted story drag the mean test score to zero", () => {
  // the collector writes testScore for every story and the PO seeds it at 0, so
  // a typeof guard never fired and a skipped story counted as a zero.
  const [aggregate] = aggregateExperimentResults([
    run(1, 1, summary({
      durationSeconds: 10,
      outcome: "incomplete",
      agents: { a: usage(1, 10, 10) },
      stories: [
        { ...story(1, "tested"), testScore: 100 },
        { ...story(2, "todo"), testScore: 0, skippedByDependency: true },
        { ...story(3, "todo"), testScore: 0 },
      ],
    })),
  ]);

  // one story was tested, at 100. the other two were never reached.
  assert.equal(aggregate.stability.testScorePerRun.mean, 100);
});

it("counts a run that wrote no summary as its own outcome", () => {
  // three runs that all died before writing anything used to report agreement
  // on an empty tally, which is the most reassuring column saying nothing.
  const [aggregate] = aggregateExperimentResults([
    run(1, 1, null),
    run(1, 0, summary({
      durationSeconds: 10,
      agents: { a: usage(1, 10, 10) },
      stories: [story(1, "tested")],
    })),
  ]);

  assert.equal(aggregate.stability.outcomeAgreement, false);
  assert.deepEqual(aggregate.stability.outcomes, {
    no_summary: 1,
    completed: 1,
  });
});

it("reports no agreement when every repeat failed to produce a summary", () => {
  const [aggregate] = aggregateExperimentResults([
    run(1, 1, null),
    run(1, 1, null),
  ]);

  assert.deepEqual(aggregate.stability.outcomes, { no_summary: 2 });
  assert.equal(aggregate.stability.completionRate, 0);
  // they agree, but on having produced nothing: completionRate is the reader
  assert.equal(aggregate.stability.outcomeAgreement, true);
});
