import { DeveloperAgent } from "../modules/agents/developer.agent.ts";
import { ReviewerAgent } from "../modules/agents/reviewer.agent.ts";
import { TesterAgent } from "../modules/agents/tester.agent.ts";
import type { Config } from "../modules/model/config.model.ts";
import type { ModelProvider } from "../modules/model/providers/modelProvider.model.ts";
import type { Story, StoryStatus } from "../modules/model/story.model.ts";
import type { Workspace } from "../modules/model/workspace.model.ts";
import { EventBus } from "../modules/service/eventBus.service.ts";
import { STORIES_PATH } from "../modules/tools/registry.ts";
import {
  readStories,
  writeStoriesFile,
} from "../modules/tools/story/stories.ts";

async function getValidationScore(
  workspace: Workspace,
  storyId: number,
  variant: "review" | "test",
  runId: string,
): Promise<number> {
  const story = (await readStories(resolve(workspace.workspaceDir, STORIES_PATH)))?.stories.find(
    (story) => story.id === storyId,
  );
  if (!story) return 0;
  const score =
    variant === "review" ? story.reviewResult.score : story.testResult.score;
  EventBus.getInstance().publish({
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
): Promise<void> {
  await new agentClass(
    storyId,
    resolve(workspace.workspaceDir, STORIES_PATH),
    workspace,
    modelProvider,
    config.timeoutMinutes,
    runId,
  ).run(storyId, iteration);
}

export async function runStory(
  storyId: number,
  workspace: Workspace,
  modelProvider: ModelProvider,
  config: Config,
  runId: string,
): Promise<void> {
  const storyFile = resolve(workspace.workspaceDir, STORIES_PATH);

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    await runAgent(
      DeveloperAgent,
      storyId,
      workspace,
      modelProvider,
      config,
      iteration,
      runId,
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
      );
      if (
        (await getValidationScore(workspace, storyId, "review", runId)) <
        config.minScore
      ) {
        continue;
      }
      // TODO when not approved and last run also markBlocked
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
      );
      if (
        (await getValidationScore(workspace, storyId, "test", runId)) >=
        config.minScore
      ) {
        return;
      }
    }
  }

  await markBlocked(storyFile, storyId, config, runId);
}

async function markBlocked(
  storiesPath: string,
  storyId: number,
  config: Config,
  runId: string,
): Promise<void> {
  const state = await readStories(storiesPath);
  if (!state) return;
  const story = state.stories.find((story) => story.id === storyId);
  if (
    !story ||
    (story.status === config.terminalStatus &&
      passedEnabledGates(story, config))
  ) {
    return;
  }

  await writeStoriesFile(
    storiesPath,
    state.stories.map((story) =>
      story.id === storyId
        ? { ...story, status: "blocked" as StoryStatus }
        : story,
    ),
  );
  EventBus.getInstance().publish({
    type: "story_blocked",
    runId,
    storyId,
    detail: "iteration budget exhausted without passing the enabled gates",
    timestamp: new Date().toISOString(),
  });
}

function passedEnabledGates(story: Story, config: Config): boolean {
  if (config.testerEnabled) return story.testResult.score >= config.minScore;
  if (config.reviewerEnabled)
    return story.reviewResult.score >= config.minScore;
  return true;
}
import { resolve } from "node:path";
