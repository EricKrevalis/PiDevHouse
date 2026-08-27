import type { Summary } from "../model/summary.model.ts";

// reduces experiment.ts's per-run results into per-variant stats across repeats.

// local copy of the fields this needs from experiment.ts's Result.
// importing Result directly would run experiment.ts's main() on import.
export interface ExperimentRunResult {
  variantIndex: number;
  exitCode: number;
  summary: Summary | null;
}

// null fields mean zero samples, not a real zero.
export interface Stat {
  mean: number | null;
  stddev: number | null;
  min: number | null;
  max: number | null;
}

export interface VariantAggregate {
  variantIndex: number;
  runCount: number;
  failureCount: number;
  failureRate: number;
  // stats below cover only runs with a summary.
  durationSeconds: Stat;
  totalTokens: Stat;
  totalCalls: Stat;
  // mean wall-clock ms per agent invocation, run with zero invocations counts as 0.
  durationPerInvocationMs: Stat;
  // tested / total stories, summed across repeats not averaged per run.
  testedStoryRatio: number;
  // total tool calls / total stories across repeats with a summary.
  callsPerStory: number;
}

function isFailure(result: ExperimentRunResult): boolean {
  return (
    result.exitCode !== 0 ||
    result.summary === null ||
    result.summary.outcome !== "completed"
  );
}

function runTokens(summary: Summary): number {
  return Object.values(summary.agents).reduce(
    (sum, usage) => sum + usage.inputTokens + usage.outputTokens,
    0,
  );
}

function runCalls(summary: Summary): number {
  return Object.values(summary.agents).reduce(
    (sum, usage) => sum + usage.calls,
    0,
  );
}

// 0 when the run recorded no invocations, avoids NaN.
function runDurationPerInvocation(summary: Summary): number {
  const totals = Object.values(summary.agents).reduce(
    (acc, usage) => ({
      duration: acc.duration + usage.totalDurationMs,
      invocations: acc.invocations + usage.invocations,
    }),
    { duration: 0, invocations: 0 },
  );
  return totals.invocations === 0 ? 0 : totals.duration / totals.invocations;
}

// stddev divides by N, the repeats are the full population not a sample.
function stat(samples: number[]): Stat {
  if (samples.length === 0) {
    return { mean: null, stddev: null, min: null, max: null };
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    samples.length;
  return {
    mean,
    stddev: Math.sqrt(variance),
    min: Math.min(...samples),
    max: Math.max(...samples),
  };
}

export function aggregateExperimentResults(
  results: ExperimentRunResult[],
): VariantAggregate[] {
  const groups = new Map<number, ExperimentRunResult[]>();
  for (const result of results) {
    const group = groups.get(result.variantIndex);
    if (group) group.push(result);
    else groups.set(result.variantIndex, [result]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([variantIndex, group]) => {
      const withSummary = group.flatMap((result) =>
        result.summary ? [result.summary] : [],
      );
      const failureCount = group.filter(isFailure).length;

      let testedStories = 0;
      let totalStories = 0;
      let totalCallsSum = 0;
      for (const summary of withSummary) {
        testedStories += summary.stories.filter(
          (story) => story.status === "tested",
        ).length;
        totalStories += summary.stories.length;
        totalCallsSum += runCalls(summary);
      }

      return {
        variantIndex,
        runCount: group.length,
        failureCount,
        failureRate: group.length === 0 ? 0 : failureCount / group.length,
        durationSeconds: stat(
          withSummary.map((summary) => summary.durationSeconds),
        ),
        totalTokens: stat(withSummary.map(runTokens)),
        totalCalls: stat(withSummary.map(runCalls)),
        durationPerInvocationMs: stat(
          withSummary.map(runDurationPerInvocation),
        ),
        testedStoryRatio: totalStories === 0 ? 0 : testedStories / totalStories,
        callsPerStory: totalStories === 0 ? 0 : totalCallsSum / totalStories,
      };
    });
}
