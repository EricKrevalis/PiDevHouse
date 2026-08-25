import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storySchema } from "../../src/modules/models/story.model";
import { StoryRepository } from "../../src/modules/repository/story.repository";
import { createCreateStoriesTool } from "../../src/modules/tools/storys/createStories";
import { createUpdateStoryStatusTool } from "../../src/modules/tools/storys/updateStoryStatus";

let directory: string | undefined;

afterEach(() =>
  directory ? rm(directory, { recursive: true }) : Promise.resolve(),
);

test("rejects unusable story ids", () => {
  const story = {
    id: 0,
    title: "Invalid",
    description: "Invalid story",
    acceptanceCriteria: [],
    blockedBy: [],
    status: "todo",
    reviewResult: { score: 0, note: "" },
    testResult: { score: 0, note: "" },
  };

  expect(storySchema.safeParse(story).success).toBeFalse();
  expect(
    storySchema.safeParse({ ...story, id: 1, blockedBy: [0] }).success,
  ).toBeFalse();
});

test("rejects failed custom-tool operations", async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-story-tool-"));
  const repository = new StoryRepository(
    join(directory, "stories.json") as never,
  );
  const tool = createUpdateStoryStatusTool(repository);

  await expect(
    (tool.execute as Function)("call", { id: 1, status: "in_progress" }),
  ).rejects.toThrow("story 1 not found");
});

test("rejects duplicate ids in one story batch", async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-story-tool-"));
  const repository = new StoryRepository(
    join(directory, "stories.json") as never,
  );
  const tool = createCreateStoriesTool(repository);
  const story = {
    id: 1,
    title: "Duplicate",
    description: "Duplicate story",
    acceptanceCriteria: [],
    blockedBy: [],
    status: "todo",
  };

  await expect(
    (tool.execute as Function)("call", { stories: [story, story] }),
  ).rejects.toThrow("duplicate story ids: 1");
});
