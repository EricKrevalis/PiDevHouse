import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it } from "vitest";
import type { Story } from "../../model/story.model.ts";
import {
  Mutex,
  readStories,
  validateStories,
  writeStoriesFile,
} from "../story/stories.ts";

function story(id: number, blockedBy: number[] = []): Story {
  return {
    id,
    title: `Story ${id}`,
    description: "desc",
    acceptanceCriteria: ["criterion"],
    blockedBy,
    status: "todo",
    reviewResult: { score: 0, note: "" },
    testResult: { score: 0, note: "" },
  };
}

it("Mutex acquires resolve in FIFO order", async () => {
  const mutex = new Mutex();
  const release1 = await mutex.acquire();
  const order: string[] = [];
  const second = mutex.acquire().then((release) => {
    order.push("second");
    release();
  });
  const third = mutex.acquire().then((release) => {
    order.push("third");
    release();
  });
  await Promise.resolve();
  release1();
  await Promise.all([second, third]);
  assert.deepEqual(order, ["second", "third"]);
});

it("writeStoriesFile writes a readable story file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidev-"));
  const path = join(dir, "stories.json");
  await writeStoriesFile(path, [story(1)]);
  assert.deepEqual((await readStories(path))?.stories, [story(1)]);
});

it("validateStories rejects duplicate ids and unknown dependency ids", () => {
  assert.equal(
    typeof validateStories(JSON.stringify({ stories: [story(1), story(1)] })),
    "string",
  );
  assert.equal(
    typeof validateStories(JSON.stringify({ stories: [story(1, [99])] })),
    "string",
  );
  assert.equal(
    typeof validateStories(JSON.stringify({ stories: [story(1)] })),
    "object",
  );
});
