import { resolve } from "node:path";
import { DeveloperAgent } from "../modules/agents/developer.agent.ts";
import { ReviewerAgent } from "../modules/agents/reviewer.agent.ts";
import { TesterAgent } from "../modules/agents/tester.agent.ts";
import type { Config } from "../modules/model/config.model.ts";
import type { ModelProvider } from "../modules/model/providers/modelProvider.model.ts";
import type { StoryStatus } from "../modules/model/story.model.ts";
import type { Workspace } from "../modules/model/workspace.model.ts";
import { AgentEventService } from "../modules/service/agentEvent.service.ts";
import { STORIES_PATH } from "../modules/tools/registry.ts";
import {
  readStories,
  writeStoriesFile,
} from "../modules/tools/story/stories.ts";

async function getValidationScore(
  workspace: Workspace,
  storyId: number,
  variant: "review" | "test",
): Promise<number> {
  const storiesPath = resolve(workspace.workspaceDir, STORIES_PATH);
  const story = (await readStories(storiesPath))?.stories.find(
    (story) => story.id === storyId,
  );
  if (!story) return 0;
  const score =
    variant === "review" ? story.reviewResult.score : story.testResult.score;
  AgentEventService.getInstance().emit(
    `\nStory ${storyId} ${variant}_score: ${score}\n`,
  );
  return score;
}

async function runAgent(
  agentClass: typeof DeveloperAgent | typeof ReviewerAgent | typeof TesterAgent,
  storyId: number,
  workspace: Workspace,
  modelProvider: ModelProvider,
  config: Config,
  iteration: number,
): Promise<void> {
  await new agentClass(
    storyId,
    resolve(workspace.workspaceDir, STORIES_PATH),
    workspace,
    modelProvider,
    config.timeoutMinutes,
  ).run(storyId, iteration);
}

export async function runStory(
  storyId: number,
  workspace: Workspace,
  modelProvider: ModelProvider,
  config: Config,
): Promise<void> {
  const storiesPath = resolve(workspace.workspaceDir, STORIES_PATH);

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    await runAgent(
      DeveloperAgent,
      storyId,
      workspace,
      modelProvider,
      config,
      iteration,
    );

    if (config.reviewerEnabled) {
      await runAgent(
        ReviewerAgent,
        storyId,
        workspace,
        modelProvider,
        config,
        iteration,
      );
      if (
        (await getValidationScore(workspace, storyId, "review")) <
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
      );
      if (
        (await getValidationScore(workspace, storyId, "test")) >=
        config.minScore
      ) {
        return;
      }
    }
  }

  await markBlocked(storiesPath, storyId, config);
}

async function markBlocked(
  storiesPath: string,
  storyId: number,
  config: Config,
): Promise<void> {
  const state = await readStories(storiesPath);
  if (!state) return;
  const story = state.stories.find((story) => story.id === storyId);
  if (!story || story.status === config.terminalStatus) return;

  await writeStoriesFile(
    storiesPath,
    state.stories.map((story) =>
      story.id === storyId
        ? { ...story, status: "blocked" as StoryStatus }
        : story,
    ),
  );
  AgentEventService.getInstance().emit(
    `\nStory ${storyId} marked blocked: iteration budget exhausted without passing the enabled gates\n`,
  );
}
