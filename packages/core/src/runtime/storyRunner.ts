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
    const reviewPlateau = { best: -Infinity, flat: 0 };
    const testPlateau = { best: -Infinity, flat: 0 };
    let silentGates = 0;
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
        const before = await readValidationResult(
          dependencies.storyStore,
          storyId,
          "review",
        );
        await runAgent(
          ReviewerAgent,
          storyId,
          workspace,
          modelProvider,
          config,
          iteration,
          runId,
          dependencies,
          signal,
        );
        const after = await readValidationResult(
          dependencies.storyStore,
          storyId,
          "review",
        );
        if (after === undefined || sameResult(before, after)) {
          silentGates++;
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
        const before = await readValidationResult(
          dependencies.storyStore,
          storyId,
          "test",
        );
        await runAgent(
          TesterAgent,
          storyId,
          workspace,
          modelProvider,
          config,
          iteration,
          runId,
          dependencies,
          signal,
        );
        const after = await readValidationResult(
          dependencies.storyStore,
          storyId,
          "test",
        );
        if (after !== undefined && !sameResult(before, after)) {
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
          `${silentGates} gate run(s) ended without a written verdict`
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
  summaryCollector?: { noteBlocked(params: { storyId: number; reason: string }): void },
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
