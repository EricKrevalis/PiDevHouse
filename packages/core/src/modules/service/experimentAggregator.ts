import type { Summary } from "../model/summary.model.ts";
import {
  classifyFailure,
  isInfrastructureFailure,
} from "./failureClassifier.ts";

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
  // failureRate above mixes model and infrastructure failure; these split it.
  // a model comparison should read modelFailureRate, never failureRate.
  modelFailureCount: number;
  modelFailureRate: number;
  infraFailureCount: number;
  infraFailureRate: number;
  // runs whose outcome is attributable to the model, so their numbers compare.
  validRunCount: number;
  failureClasses: Record<string, number>;
  // stats below cover only valid runs, so one hung command cannot inflate a
  // variant's mean duration.
  durationSeconds: Stat;
  totalTokens: Stat;
  totalCalls: Stat;
  // mean wall-clock ms per agent invocation, run with zero invocations counts as 0.
  durationPerInvocationMs: Stat;
  // tested / total stories, summed across repeats not averaged per run.
  testedStoryRatio: number;
  // assistant turns / total stories across repeats with a summary. named for
  // `calls`, which counts turns rather than tool calls.
  callsPerStory: number;
  // scope refusals over refusals plus executed tool calls. the share of an
  // agent's tool calls the scope guard refused before they ran.
  rejectedCallRatio: number;
  // bash denials over executed tool calls. tracked apart from the ratio above
  // because a denied command is rewritten rather than blocked, so it executes:
  // it is waste the scope guard never sees, and historically the larger share.
  sandboxDenialRatio: number;
  // stories never attempted because a dependency blocked, over all stories.
  skippedStoryRatio: number;
  // same input, same configuration, different runs. the mean alone cannot say
  // whether a variant is reliable, so the spread across repeats is its own
  // block: chapter 05's regression check reads this, not the averages above.
  stability: StabilityAggregate;
}

export interface StabilityAggregate {
  // runs that reached outcome "completed", over every run of the variant.
  completionRate: number;
  // every repeat landed on the same outcome class. false means the variant is
  // not reproducible regardless of how good its best run looked.
  outcomeAgreement: boolean;
  // distinct outcome classes observed, most frequent first.
  outcomes: Record<string, number>;
  // per-run tested/total, so partial completion has a spread and not just a
  // pooled ratio that hides which run did the work.
  testedStoryRatioPerRun: Stat;
  // per-run mean final test score, the continuous stability signal.
  testScorePerRun: Stat;
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

function runRejectedCalls(summary: Summary): number {
  return Object.values(summary.agents).reduce(
    (sum, usage) => sum + (usage.rejectedToolCalls ?? 0),
    0,
  );
}

// tool calls that actually ran. distinct from runCalls, which sums `calls` and
// therefore counts assistant turns: mixing the two gave the rejection ratio a
// denominator of turns plus rejections, which is not a rate of anything.
// falls back to `calls` for summaries written before the field existed.
function runExecutedCalls(summary: Summary): number {
  return Object.values(summary.agents).reduce(
    (sum, usage) => sum + (usage.executedToolCalls ?? usage.calls),
    0,
  );
}

function runSandboxDenials(summary: Summary): number {
  return Object.values(summary.agents).reduce(
    (sum, usage) => sum + (usage.sandboxDenials ?? 0),
    0,
  );
}

// tested / total for one run. 0 stories counts as 0, not NaN.
function runTestedRatio(summary: Summary): number {
  if (summary.stories.length === 0) return 0;
  return (
    summary.stories.filter((story) => story.status === "tested").length /
    summary.stories.length
  );
}

// mean final test score over the stories the run actually reached.
//
// a `typeof` guard did not do this: the collector writes testScore for every
// story whenever the tester is enabled, and the product owner seeds it at 0, so
// the field is always a number and a never-attempted story contributed a zero.
// a run that tested one story at 100 and never reached four more reported 20,
// which reads as a quality collapse rather than a coverage one. filter on what
// the story actually did instead.
function runMeanTestScore(summary: Summary): number | undefined {
  const scores = summary.stories.flatMap((story) =>
    typeof story.testScore === "number" &&
    story.skippedByDependency !== true &&
    story.status !== "todo"
      ? [story.testScore]
      : [],
  );
  if (scores.length === 0) return undefined;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
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
      const classes = group.map((result) => classifyFailure(result.summary));
      const infraFailureCount = classes.filter(isInfrastructureFailure).length;
      const modelFailureCount = classes.filter(
        (failureClass) =>
          failureClass !== "none" &&
          failureClass !== "cancelled" &&
          !isInfrastructureFailure(failureClass),
      ).length;
      const failureClasses = classes.reduce<Record<string, number>>(
        (counts, failureClass) => {
          if (failureClass !== "none") {
            counts[failureClass] = (counts[failureClass] ?? 0) + 1;
          }
          return counts;
        },
        {},
      );
      // duration and token stats read from valid runs only; an infrastructure
      // failure says nothing about the model and its wall clock is not its own.
      const validSummaries = group.flatMap((result) =>
        result.summary && !isInfrastructureFailure(classifyFailure(result.summary))
          ? [result.summary]
          : [],
      );

      let testedStories = 0;
      let totalStories = 0;
      let totalCallsSum = 0;
      let executedCallsSum = 0;
      let rejectedCallsSum = 0;
      let sandboxDenialsSum = 0;
      let skippedStories = 0;
      for (const summary of withSummary) {
        testedStories += summary.stories.filter(
          (story) => story.status === "tested",
        ).length;
        skippedStories += summary.stories.filter(
          (story) => story.skippedByDependency === true,
        ).length;
        totalStories += summary.stories.length;
        totalCallsSum += runCalls(summary);
        executedCallsSum += runExecutedCalls(summary);
        rejectedCallsSum += runRejectedCalls(summary);
        sandboxDenialsSum += runSandboxDenials(summary);
      }

      // a run that wrote no summary is its own outcome, not an absent one.
      // counting only withSummary let three runs that all died before writing
      // anything report "agree: yes" on an empty tally, which is the most
      // reassuring column in the table saying nothing at all.
      const outcomes = group.reduce<Record<string, number>>(
        (counts, result) => {
          const name = result.summary?.outcome ?? "no_summary";
          counts[name] = (counts[name] ?? 0) + 1;
          return counts;
        },
        {},
      );
      const completedRuns = outcomes.completed ?? 0;
      const stability: StabilityAggregate = {
        completionRate: group.length === 0 ? 0 : completedRuns / group.length,
        // one repeat cannot disagree with itself, so it is trivially in
        // agreement. read completionRate alongside it.
        outcomeAgreement: Object.keys(outcomes).length <= 1,
        outcomes,
        testedStoryRatioPerRun: stat(withSummary.map(runTestedRatio)),
        testScorePerRun: stat(
          withSummary.flatMap((summary) => {
            const score = runMeanTestScore(summary);
            return score === undefined ? [] : [score];
          }),
        ),
      };

      return {
        variantIndex,
        runCount: group.length,
        failureCount,
        failureRate: group.length === 0 ? 0 : failureCount / group.length,
        modelFailureCount,
        modelFailureRate:
          group.length === 0 ? 0 : modelFailureCount / group.length,
        infraFailureCount,
        infraFailureRate:
          group.length === 0 ? 0 : infraFailureCount / group.length,
        validRunCount: validSummaries.length,
        failureClasses,
        durationSeconds: stat(
          validSummaries.map((summary) => summary.durationSeconds),
        ),
        totalTokens: stat(validSummaries.map(runTokens)),
        totalCalls: stat(validSummaries.map(runCalls)),
        durationPerInvocationMs: stat(
          validSummaries.map(runDurationPerInvocation),
        ),
        testedStoryRatio: totalStories === 0 ? 0 : testedStories / totalStories,
        callsPerStory: totalStories === 0 ? 0 : totalCallsSum / totalStories,
        rejectedCallRatio:
          executedCallsSum + rejectedCallsSum === 0
            ? 0
            : rejectedCallsSum / (executedCallsSum + rejectedCallsSum),
        sandboxDenialRatio:
          executedCallsSum === 0 ? 0 : sandboxDenialsSum / executedCallsSum,
        skippedStoryRatio:
          totalStories === 0 ? 0 : skippedStories / totalStories,
        stability,
      };
    });
}
