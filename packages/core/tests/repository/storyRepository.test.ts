import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StoryRepository } from "../../src/modules/repository/story.repository";

let directory: string;

afterEach(() => rm(directory, { recursive: true }));

test("returns no ready story for a dependency deadlock", async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-repository-"));
  const repository = new StoryRepository(
    join(directory, "stories.json") as never,
  );
  await repository.createStories([
    {
      id: 1,
      title: "Blocked",
      description: "Blocked forever",
      acceptanceCriteria: [],
      blockedBy: [2],
      status: "todo",
      reviewResult: { score: 0, note: "" },
      testResult: { score: 0, note: "" },
    },
  ]);

  expect(repository.getReadyStory()).toBeUndefined();
});
