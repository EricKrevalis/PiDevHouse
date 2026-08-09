import { STORIES_PATH } from "../models/agents.ts";
import type { RunTimer } from "../models/timer.ts";
import type { Workspace } from "../models/workspace.ts";
import { DeveloperAgent } from "../agents/developer.ts";
import { ReviewerAgent } from "../agents/reviewer.ts";
import { TesterAgent } from "../agents/tester.ts";
import { readStories } from "../tools/stories.ts";
import { type ModelEnv } from "../utils/ollama.ts";
import { resolve } from "node:path";

const MIN_VALIDATION_SCORE = 75;
const MAX_ITERATIONS = 3;

async function getValidationScore(
  workspace: Workspace,
  storyId: number,
  variant: "review" | "test",
): Promise<number> {
  const storiesPath = resolve(workspace.workspaceDir, STORIES_PATH);
  const storys = await readStories(storiesPath);
  const story = storys?.stories.find((story) => story.id == storyId);

  switch (variant) {
    case "review":
      return story?.reviewResult.score ?? 0;
    case "test":
      return story?.testResult.score ?? 0;
    default:
      return 0;
  }
}

export async function runStory(
  storyId: number,
  workspace: Workspace,
  runtime: ModelEnv,
  timer: RunTimer,
): Promise<void> {
  let reviewScore = 0;
  for (let i = 0; i < MAX_ITERATIONS && reviewScore < MIN_VALIDATION_SCORE; i++) {
    await new DeveloperAgent(storyId, STORIES_PATH).run(
      workspace,
      runtime,
      timer,
      storyId,
      i + 1,
    );

    await new ReviewerAgent(storyId, STORIES_PATH).run(
      workspace,
      runtime,
      timer,
      storyId,
      i + 1,
    );

    reviewScore = await getValidationScore(workspace, storyId, "review");
  }

  let testScore = 0;
  for (let i = 0; i < MAX_ITERATIONS && testScore < MIN_VALIDATION_SCORE; i++) {
    await new DeveloperAgent(storyId, STORIES_PATH).run(
      workspace,
      runtime,
      timer,
      storyId,
      i + 1,
    );

    await new TesterAgent(storyId, STORIES_PATH).run(
      workspace,
      runtime,
      timer,
      storyId,
      i + 1,
    );
    testScore = await getValidationScore(workspace, storyId, "test");
  }
}
