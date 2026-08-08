import { resolve } from "node:path";
import { DeveloperAgent } from "../modules/agents/developer.agent.ts";
import { ReviewerAgent } from "../modules/agents/reviewer.agent.ts";
import { TesterAgent } from "../modules/agents/tester.agent.ts";
import type { ModelProvider } from "../modules/model/providers/modelProvider.model.ts";
import type { Workspace } from "../modules/model/workspace.model.ts";
import { STORIES_PATH } from "../modules/tools/registry.ts";
import { readStories } from "../modules/tools/story/stories.ts";

const MIN_VALIDATION_SCORE = 75;
const MAX_ITERATIONS = 4;

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
  return variant === "review"
    ? story.reviewResult.score
    : story.testResult.score;
}

export async function runStories(
  storyId: number,
  workspace: Workspace,
  modelProvider: ModelProvider,
): Promise<void> {
  const storiesPath = resolve(workspace.workspaceDir, STORIES_PATH);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    await new DeveloperAgent(
      storyId,
      storiesPath,
      workspace,
      modelProvider,
    ).run(storyId, i + 1);
    await new ReviewerAgent(storyId, storiesPath, workspace, modelProvider).run(
      storyId,
      i + 1,
    );
    if (
      (await getValidationScore(workspace, storyId, "review")) <
      MIN_VALIDATION_SCORE
    ) {
      continue;
    }
    await new TesterAgent(storyId, storiesPath, workspace, modelProvider).run(
      storyId,
      i + 1,
    );
    if (
      (await getValidationScore(workspace, storyId, "test")) >=
      MIN_VALIDATION_SCORE
    ) {
      break;
    }
  }
}
