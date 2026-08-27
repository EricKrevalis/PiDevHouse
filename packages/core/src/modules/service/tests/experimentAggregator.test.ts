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
  timing?: { totalDurationMs: number; invocations: number },
): AgentUsage {
  return {
    calls,
    inputTokens,
    outputTokens,
    reasoningTokens: 0,
    totalDurationMs: timing?.totalDurationMs ?? 0,
    invocations: timing?.invocations ?? 0,
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

it("treats a non-completed outcome as a failure but still uses its numbers", () => {
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
  // both runs feed the stats even though one is a failure
  assert.equal(aggregate.durationSeconds.mean, 20);
  assert.equal(aggregate.totalCalls.mean, 2);
  assert.equal(aggregate.testedStoryRatio, 0.5);
});

it("returns an empty array for empty input without throwing", () => {
  assert.deepEqual(aggregateExperimentResults([]), []);
});
