import assert from "node:assert/strict";
import { it } from "vitest";
import type { AgentUsage, Summary } from "../../model/summary.model.ts";
import {
  classifyFailure,
  isInfrastructureFailure,
  isValidRun,
} from "../failureClassifier.ts";

function usage(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return {
    calls: 1,
    inputTokens: 10,
    outputTokens: 10,
    reasoningTokens: 0,
    totalDurationMs: 0,
    invocations: 1,
    timedOutInvocations: 0,
    longestInvocationMs: 0,
    longestToolCallMs: 0,
    ...overrides,
  };
}

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    durationSeconds: 60,
    request: "req",
    outcome: "completed",
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
    agents: {},
    stories: [],
    ...overrides,
  };
}

it("classifies a completed run as no failure", () => {
  assert.equal(classifyFailure(summary()), "none");
  assert.equal(isValidRun(summary()), true);
});

it("treats a missing summary as unknown infrastructure", () => {
  assert.equal(classifyFailure(null), "unknown");
  assert.equal(isInfrastructureFailure("unknown"), true);
  assert.equal(isValidRun(null), false);
});

// the hung command caused the timeout, so the cause must outrank the symptom.
it("ranks a hung tool call above the timeout it caused", () => {
  const failureClass = classifyFailure(
    summary({
      outcome: "incomplete",
      failureMode: "recovery",
      agents: {
        reviewer: usage({ timedOutInvocations: 1, longestToolCallMs: 983_000 }),
      },
    }),
  );

  assert.equal(failureClass, "tool_hang");
  assert.equal(isInfrastructureFailure(failureClass), true);
});

// the same overrun without a hung command was spent in the model itself.
it("calls a budget overrun with no hung command a model failure", () => {
  const failureClass = classifyFailure(
    summary({
      outcome: "incomplete",
      failureMode: "recovery",
      agents: {
        tester: usage({ timedOutInvocations: 4, longestToolCallMs: 9_000 }),
      },
    }),
  );

  assert.equal(failureClass, "agent_timeout");
  assert.equal(isInfrastructureFailure(failureClass), false);
  assert.equal(
    isValidRun(
      summary({
        outcome: "incomplete",
        agents: { tester: usage({ timedOutInvocations: 4 }) },
      }),
    ),
    true,
  );
});

it("separates a provider error from a model failure", () => {
  assert.equal(classifyFailure(summary({ outcome: "error" })), "provider");
  assert.equal(
    classifyFailure(summary({ outcome: "incomplete", failureMode: "recovery" })),
    "model",
  );
});

it("keeps a cancelled run out of both failure buckets", () => {
  const failureClass = classifyFailure(summary({ outcome: "cancelled" }));
  assert.equal(failureClass, "cancelled");
  assert.equal(isInfrastructureFailure(failureClass), false);
  // operator cancellation is evidence about neither the model nor the harness
  assert.equal(isValidRun(summary({ outcome: "cancelled" })), false);
});
