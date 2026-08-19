import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it } from "vitest";
import type { Story } from "../../model/story.model.ts";
import {
  Mutex,
  readStories,
  StoryStore,
  validateStories,
  writeStoriesFile,
} from "../story/stories.ts";
import { createWriteStoriesTool } from "../story/writeStories.ts";

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

it("StoryStore instances do not share a mutation lock", async () => {
  const first = new StoryStore("first/stories.json");
  const second = new StoryStore("second/stories.json");
  const release = await first.acquire();
  let secondAcquired = false;

  const secondTurn = second.acquire().then((releaseSecond) => {
    secondAcquired = true;
    releaseSecond();
  });
  await secondTurn;
  release();

  assert.equal(secondAcquired, true);
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

it("write_stories resets review and test scores regardless of submission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidev-"));
  const storyStore = new StoryStore(join(dir, "stories.json"));
  const tool = createWriteStoriesTool(storyStore);
  const fabricated = {
    ...story(1),
    status: "implemented",
    reviewResult: { score: 92, note: "pre-filled" },
    testResult: { score: 95, note: "pre-filled" },
  };

  await tool.execute(
    "call",
    { stories: [fabricated] },
    undefined,
    undefined,
    {} as Parameters<typeof tool.execute>[4],
  );

  const written = (await storyStore.read())?.stories[0];
  assert.deepEqual(written?.reviewResult, { score: 0, note: "" });
  assert.deepEqual(written?.testResult, { score: 0, note: "" });
});

it("StoryStore.setStatus sets the status idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pidev-"));
  const storyStore = new StoryStore(join(dir, "stories.json"));
  await storyStore.write([story(1)]);

  await storyStore.setStatus(1, "approved");
  await storyStore.setStatus(1, "approved");
  await storyStore.setStatus(1, "tested");

  const written = (await storyStore.read())?.stories[0];
  assert.equal(written?.status, "tested");
});
