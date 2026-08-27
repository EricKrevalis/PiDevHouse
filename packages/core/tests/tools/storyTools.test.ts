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
    acceptanceCriteria: ["It works"],
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

test("rejects stories without acceptance criteria", () => {
  expect(
    storySchema.safeParse({
      id: 1,
      title: "Incomplete",
      description: "Missing its contract",
      acceptanceCriteria: [],
      blockedBy: [],
      status: "todo",
      reviewResult: { score: 0, note: "" },
      testResult: { score: 0, note: "" },
    }).success,
  ).toBeFalse();
});

test("rejects malformed acceptance criteria", () => {
  const story = {
    id: 1,
    title: "Malformed",
    description: "Malformed story",
    acceptanceCriteria: [":x"],
    blockedBy: [],
    status: "todo",
    reviewResult: { score: 0, note: "" },
    testResult: { score: 0, note: "" },
  };

  expect(storySchema.safeParse(story).success).toBeFalse();
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
    acceptanceCriteria: ["It works"],
    blockedBy: [],
    status: "todo",
  };

  await expect(
    (tool.execute as Function)("call", { stories: [story, story] }),
  ).rejects.toThrow("duplicate story ids: 1");
});

test("creates stories with validation fields in stable order", async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-story-tool-"));
  const repository = new StoryRepository(
    join(directory, "stories.json") as never,
  );
  const tool = createCreateStoriesTool(repository);

  await (tool.execute as Function)("call", {
    stories: [
      {
        status: "todo",
        blockedBy: [],
        title: "Stable",
        acceptanceCriteria: ["It works"],
        description: "Stable story",
        id: 1,
      },
    ],
  });

  expect(Object.keys(repository.getStory(1)!)).toEqual([
    "id",
    "title",
    "description",
    "acceptanceCriteria",
    "blockedBy",
    "status",
    "reviewResult",
    "testResult",
  ]);
});

test("replaces a previous story plan", async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-story-tool-"));
  const repository = new StoryRepository(
    join(directory, "stories.json") as never,
  );
  const tool = createCreateStoriesTool(repository);
  const makeStory = (title: string) => ({
    id: 1,
    title,
    description: `${title} story`,
    acceptanceCriteria: ["It works"],
    blockedBy: [],
    status: "todo",
  });

  await (tool.execute as Function)("first", {
    stories: [makeStory("First")],
  });
  await (tool.execute as Function)("corrected", {
    stories: [makeStory("Corrected")],
  });

  expect(repository.getStories()).toHaveLength(1);
  expect(repository.getStory(1)?.title).toBe("Corrected");
});

test("requires browser evidence before marking a tested story", async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-story-tool-"));
  const repository = new StoryRepository(
    join(directory, "stories.json") as never,
  );
  await repository.createStories([
    {
      id: 1,
      title: "Evidence",
      description: "Evidence story",
      acceptanceCriteria: ["First works", "Second works"],
      blockedBy: [],
      status: "approved",
      reviewResult: { score: 100, note: "" },
      testResult: { score: 100, note: "" },
    },
  ]);
  const captured = new Set([1]);
  const tool = createUpdateStoryStatusTool(repository, captured);

  await expect(
    (tool.execute as Function)("call", { id: 1, status: "tested" }),
  ).rejects.toThrow("acceptance criteria: 2");
  captured.add(2);
  await (tool.execute as Function)("call", { id: 1, status: "tested" });
  expect(repository.getStory(1)?.status).toBe("tested");
});
