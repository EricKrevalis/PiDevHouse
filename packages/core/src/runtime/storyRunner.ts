import { resolve } from "node:path";
import { DeveloperAgent } from "../modules/agents/developer.agent.ts";
import { ReviewerAgent } from "../modules/agents/reviewer.agent.ts";
import { TesterAgent } from "../modules/agents/tester.agent.ts";
import type { AgentContext } from "../modules/model/agents/agent.model.ts";
import type { Config } from "../modules/model/config.model.ts";
import type { MessagePublisher } from "../modules/model/messagePublisher.model.ts";
import type { ModelProvider } from "../modules/model/providers/modelProvider.model.ts";
import type { Story } from "../modules/model/story.model.ts";
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

async function getValidationScore(
  storyStore: StoryStore,
  storyId: number,
  variant: "review" | "test",
  runId: string,
  messagePublisher: MessagePublisher,
): Promise<number> {
  const story = (await storyStore.read())?.stories.find(
    (story) => story.id === storyId,
  );
  if (!story) return 0;
  const score =
    variant === "review" ? story.reviewResult.score : story.testResult.score;
  messagePublisher.publish({
    type: "story_score",
    runId,
    storyId,
    variant,
    score,
    timestamp: new Date().toISOString(),
  });
  return score;
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
    config.timeoutMinutes,
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

      if (config.reviewerEnabled) {
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
        const reviewScore = await getValidationScore(
          dependencies.storyStore,
          storyId,
          "review",
          runId,
          this.messagePublisher,
        );
        if (reviewScore < config.minScore) {
          const review = trackPlateau(reviewScore, config.minScore, reviewPlateau);
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
            );
            return;
          }
          continue;
        }
        if (!config.testerEnabled) return;
      }

      if (config.testerEnabled) {
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
        const testScore = await getValidationScore(
          dependencies.storyStore,
          storyId,
          "test",
          runId,
          this.messagePublisher,
        );
        if (testScore >= config.minScore) {
          return;
        }
        const test = trackPlateau(testScore, config.minScore, testPlateau);
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
          );
          return;
        }
      }
    }

    await markBlocked(
      dependencies.storyStore,
      storyId,
      config,
      runId,
      this.messagePublisher,
    );
  }
}

async function markBlocked(
  storyStore: StoryStore,
  storyId: number,
  config: Config,
  runId: string,
  messagePublisher: MessagePublisher,
  reason = "iteration budget exhausted without passing the enabled gates",
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
  }
}

function passedEnabledGates(story: Story, config: Config): boolean {
  if (config.testerEnabled) return story.testResult.score >= config.minScore;
  if (config.reviewerEnabled)
    return story.reviewResult.score >= config.minScore;
  return true;
}
