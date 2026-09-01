import { resolve } from "node:path";
import { DeveloperAgent } from "../modules/agents/developer.agent.ts";

import { ReviewerAgent } from "../modules/agents/reviewer.agent.ts";
import { TesterAgent } from "../modules/agents/tester.agent.ts";
import type { AgentContext } from "../modules/model/agents/agent.model.ts";
import type { Config } from "../modules/model/config.model.ts";
import type { MessagePublisher } from "../modules/model/messagePublisher.model.ts";
import type { ModelProvider } from "../modules/model/providers/modelProvider.model.ts";
import type { Story, ValidationResult } from "../modules/model/story.model.ts";
import type { Workspace } from "../modules/model/workspace.model.ts";
import { STORIES_PATH } from "../modules/tools/registry.ts";
import { StoryStore } from "../modules/tools/story/stories.ts";

export function trackPlateau(
  score: number,
  minScore: number,
  state: { best: number; flat: number },
): { best: number; flat: number; plateau: boolean } {
  if (score >= minScore) return { ...state, plateau: false };
  const best = Math.max(state.best, score);
  const flat = score <= state.best ? state.flat + 1 : 0;
  return { best, flat, plateau: flat >= 2 };
}

async function readValidationResult(
  storyStore: StoryStore,
  storyId: number,
  variant: "review" | "test",
): Promise<ValidationResult | undefined> {
  const story = (await storyStore.read())?.stories.find(
    (candidate) => candidate.id === storyId,
  );
  if (!story) return undefined;
  return variant === "review" ? story.reviewResult : story.testResult;
}

function sameResult(
  a: ValidationResult | undefined,
  b: ValidationResult | undefined,
): boolean {
  return a?.score === b?.score && a?.note === b?.note;
}

async function runAgent(
  agentClass: typeof DeveloperAgent | typeof ReviewerAgent | typeof TesterAgent,
  storyId: number,
  workspace: Workspace,
  modelProvider: ModelProvider,
  config: Config,
  iteration: number,
  runId: string,
  dependencies: AgentContext,
  signal?: AbortSignal,
): Promise<void> {
  await new agentClass(
    storyId,
    resolve(workspace.workspaceDir, STORIES_PATH),
    workspace,
    modelProvider,
    config,
    runId,
    dependencies,
  ).run(storyId, iteration, signal);
}

interface GateOutcome {
  result?: ValidationResult;
  silent: boolean;
  retries: number;
}

// runs a gate and, when it writes no verdict, runs it once more before the
// iteration gives up. the old answer to "the gate told us nothing" was another
// developer pass, which rewrites working code to recover a missing write and
// spends the most expensive agent in the loop on it. the rerun is a fresh
// agent, so it gets a new session and a new tool-call budget, which is also
// what clears an exhausted budget that refused the closing write.
async function runGate(params: {
  agentClass: typeof ReviewerAgent | typeof TesterAgent;
  variant: "review" | "test";
  storyId: number;
  workspace: Workspace;
  modelProvider: ModelProvider;
  config: Config;
  iteration: number;
  runId: string;
  dependencies: AgentContext;
  signal?: AbortSignal;
}): Promise<GateOutcome> {
  const before = await readValidationResult(
    params.dependencies.storyStore,
    params.storyId,
    params.variant,
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    await runAgent(
      params.agentClass,
      params.storyId,
      params.workspace,
      params.modelProvider,
      params.config,
      params.iteration,
      params.runId,
      params.dependencies,
      params.signal,
    );
    const after = await readValidationResult(
      params.dependencies.storyStore,
      params.storyId,
      params.variant,
    );
    if (after !== undefined && !sameResult(before, after)) {
      return { result: after, silent: false, retries: attempt };
    }
  }
  // both attempts ended without a verdict, so the caller falls back to a
  // developer iteration. retries counts the rerun, not the first attempt.
  return { silent: true, retries: 1 };
}

export class StoryRunner {
  constructor(private readonly messagePublisher: MessagePublisher) {}

  async run(
    storyId: number,
    workspace: Workspace,
    modelProvider: ModelProvider,
    config: Config,
    runId: string,
    dependencies: AgentContext,
    signal?: AbortSignal,
  ): Promise<void> {
    let gateRetries = 0;
    let silentGates = 0;
    try {
      await this.runStory({
        storyId,
        workspace,
        modelProvider,
        config,
        runId,
        dependencies,
        signal,
        countRetry: (count: number): void => {
          gateRetries += count;
        },
        countSilent: (): void => {
          silentGates += 1;
        },
      });
    } finally {
      // in a finally so the counts survive an abort, and outside markBlocked so
      // a story that hit a silent gate and then passed still reports it.
      dependencies.summaryCollector.noteGateOutcome({
        storyId,
        gateRetries,
        silentGates,
      });
    }
  }

  private async runStory({
    storyId,
    workspace,
    modelProvider,
    config,
    runId,
    dependencies,
    signal,
    countRetry,
    countSilent,
  }: {
    storyId: number;
    workspace: Workspace;
    modelProvider: ModelProvider;
    config: Config;
    runId: string;
    dependencies: AgentContext;
    signal?: AbortSignal;
    countRetry: (count: number) => void;
    countSilent: () => void;
  }): Promise<void> {
    const reviewPlateau = { best: -Infinity, flat: 0 };
    const testPlateau = { best: -Infinity, flat: 0 };
    let silentGates = 0;
    let gateRetries = 0;
    for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
      await runAgent(
        DeveloperAgent,
        storyId,
        workspace,
        modelProvider,
        config,
        iteration,
        runId,
        dependencies,
        signal,
      );

      if (!config.reviewerEnabled && !config.testerEnabled) {
        const done = (await dependencies.storyStore.read())?.stories.find(
          (item) => item.id === storyId,
        );
        if (done?.status === config.terminalStatus) return;
        continue;
      }

      if (config.reviewerEnabled) {
        const gate = await runGate({
          agentClass: ReviewerAgent,
          variant: "review",
          storyId,
          workspace,
          modelProvider,
          config,
          iteration,
          runId,
          dependencies,
          signal,
        });
        gateRetries += gate.retries;
        countRetry(gate.retries);
        const after = gate.result;
        if (gate.silent || after === undefined) {
          silentGates++;
          countSilent();
          continue;
        }
        this.publishScore({
          runId,
          storyId,
          variant: "review",
          score: after.score,
        });
        if (after.score < config.minScore) {
          const review = trackPlateau(
            after.score,
            config.minScore,
            reviewPlateau,
          );
          reviewPlateau.best = review.best;
          reviewPlateau.flat = review.flat;
          if (review.plateau) {
            await markBlocked(
              dependencies.storyStore,
              storyId,
              config,
              runId,
              this.messagePublisher,
              `review score plateaued at ${review.best} without reaching ${config.minScore}`,
              dependencies.summaryCollector,
            );
            return;
          }
          continue;
        }
        if (!config.testerEnabled) {
          await dependencies.storyStore.setStatus(
            storyId,
            config.terminalStatus,
          );
          return;
        }
      }

      if (config.testerEnabled) {
        const gate = await runGate({
          agentClass: TesterAgent,
          variant: "test",
          storyId,
          workspace,
          modelProvider,
          config,
          iteration,
          runId,
          dependencies,
          signal,
        });
        gateRetries += gate.retries;
        countRetry(gate.retries);
        const after = gate.result;
        if (!gate.silent && after !== undefined) {
          this.publishScore({
            runId,
            storyId,
            variant: "test",
            score: after.score,
          });
          if (after.score >= config.minScore) {
            await dependencies.storyStore.setStatus(
              storyId,
              config.terminalStatus,
            );
            return;
          }
          const test = trackPlateau(after.score, config.minScore, testPlateau);
          testPlateau.best = test.best;
          testPlateau.flat = test.flat;
          if (test.plateau) {
            await markBlocked(
              dependencies.storyStore,
              storyId,
              config,
              runId,
              this.messagePublisher,
              `test score plateaued at ${test.best} without reaching ${config.minScore}` +
                (config.reviewerEnabled ? " while the review passed" : ""),
              dependencies.summaryCollector,
            );
            return;
          }
        } else {
          silentGates++;
          countSilent();
        }
      }
    }

    await markBlocked(
      dependencies.storyStore,
      storyId,
      config,
      runId,
      this.messagePublisher,
      silentGates > 0
        ? "iteration budget exhausted without passing the enabled gates; " +
          // a silent gate is the whole gate giving up, which after the rerun is
          // two invocations, so this counts gates and names the reruns apart.
          `${silentGates} gate(s) wrote no verdict` +
          (gateRetries > 0
            ? `, including ${gateRetries} rerun(s) that also wrote none`
            : "")
        : undefined,
      dependencies.summaryCollector,
    );
  }

  private publishScore(params: {
    runId: string;
    storyId: number;
    variant: "review" | "test";
    score: number;
  }): void {
    this.messagePublisher.publish({
      type: "story_score",
      runId: params.runId,
      storyId: params.storyId,
      variant: params.variant,
      score: params.score,
      timestamp: new Date().toISOString(),
    });
  }
}

async function markBlocked(
  storyStore: StoryStore,
  storyId: number,
  config: Config,
  runId: string,
  messagePublisher: MessagePublisher,
  reason = "iteration budget exhausted without passing the enabled gates",
  summaryCollector?: {
    noteBlocked(params: { storyId: number; reason: string }): void;
  },
): Promise<void> {
  const state = await storyStore.read();
  const story = state?.stories.find((item) => item.id === storyId);
  if (
    !story ||
    (story.status === config.terminalStatus &&
      passedEnabledGates(story, config))
  ) {
    return;
  }

  if (
    await storyStore.block(
      storyId,
      config.terminalStatus,
      story.status === config.terminalStatus,
    )
  ) {
    messagePublisher.publish({
      type: "story_blocked",
      runId,
      storyId,
      detail: reason,
      timestamp: new Date().toISOString(),
    });
    summaryCollector?.noteBlocked({ storyId, reason });
  }
}

function passedEnabledGates(story: Story, config: Config): boolean {
  if (config.testerEnabled) return story.testResult.score >= config.minScore;
  if (config.reviewerEnabled)
    return story.reviewResult.score >= config.minScore;
  return true;
}
