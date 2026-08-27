import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StoryRepository } from "../../src/modules/repository/story.repository";
import type { Story } from "../../src/modules/models/story.model";
import type { Config } from "../../src/modules/models/config.model";

import { runStory } from "../../src/runtime/storyLoop";

type RunAgent = (...args: any[]) => Promise<any>;
let runAgent: RunAgent;
let directory: string;
let repository: StoryRepository;
let story: Story;
let retries: unknown[];
let prompts: string[];

const agentModel = await import("../../src/modules/models/agent.model");
mock.module("../../src/modules/models/agent.model", () => ({
  ...agentModel,
  runAgent: (...args: any[]) => runAgent(...args),
}));

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-story-loop-"));
  repository = new StoryRepository(join(directory, "stories.json") as never);
  story = {
    id: 1,
    title: "Story",
    description: "Description",
    acceptanceCriteria: [],
    blockedBy: [],
    status: "todo",
    reviewResult: { score: 0, note: "" },
    testResult: { score: 0, note: "" },
  };
  await repository.createStories([story]);
  retries = [];
  prompts = [];
});

afterEach(() => rm(directory, { recursive: true }));

const config: Config = {
  outputDir: "" as never,
  maxIteration: 2,
  minScore: 60,
  maxToolCalls: 10,
  runTimeoutSeconds: 1,
};

function fakeAgent(name: string) {
  return {
    name,
    eventBridge: { retry: (...args: unknown[]) => retries.push(args) },
    prompt: async (prompt: string) => prompts.push(prompt),
    close: async () => {},
  };
}

async function run() {
  return runStory(
    config,
    story,
    directory as never,
    {} as never,
    repository,
    { retry: (...args: unknown[]) => retries.push(args) } as never,
    {} as never,
    undefined,
  );
}

test("accepts the minimum score", async () => {
  runAgent = async (
    agentClass,
    _workspace,
    _model,
    _config,
    repo,
    _events,
    _summary,
    id,
  ) => {
    if (agentClass.name === "DeveloperAgent") {
      await repo.updateStoryStatus(id, "in_progress");
      await repo.updateStoryStatus(id, "implemented");
    } else if (agentClass.name === "ReviewerAgent") {
      await repo.updateValidationResult(id, { score: 60, note: "" }, "review");
      await repo.updateStoryStatus(id, "approved");
    } else {
      await repo.updateValidationResult(id, { score: 60, note: "" }, "test");
      await repo.updateStoryStatus(id, "tested");
    }
    return fakeAgent(agentClass.name);
  };

  expect(await run()).toBe("completed");
});

test("allows the same review score after test-driven rework", async () => {
  let testerCalls = 0;
  runAgent = async (
    agentClass,
    _workspace,
    _model,
    _config,
    repo,
    _events,
    _summary,
    id,
  ) => {
    if (agentClass.name === "DeveloperAgent") {
      await repo.updateStoryStatus(id, "in_progress");
      await repo.updateStoryStatus(id, "implemented");
    } else if (agentClass.name === "ReviewerAgent") {
      await repo.updateValidationResult(id, { score: 100, note: "" }, "review");
      await repo.updateStoryStatus(id, "approved");
    } else {
      testerCalls++;
      await repo.updateValidationResult(
        id,
        { score: testerCalls === 1 ? 0 : 60, note: "" },
        "test",
      );
      if (testerCalls === 2) await repo.updateStoryStatus(id, "tested");
    }
    return fakeAgent(agentClass.name);
  };

  expect(await run()).toBe("completed");
  expect(retries).toEqual([]);
});

test("stops before testing when a reviewer does not finalize", async () => {
  const calls: string[] = [];
  runAgent = async (
    agentClass,
    _workspace,
    _model,
    _config,
    repo,
    _events,
    _summary,
    id,
  ) => {
    calls.push(agentClass.name);
    if (agentClass.name === "DeveloperAgent") {
      await repo.updateStoryStatus(id, "in_progress");
      await repo.updateStoryStatus(id, "implemented");
    }
    return fakeAgent(agentClass.name);
  };

  expect(await run()).toBe("incomplete");
  expect(calls).toEqual([
    "DeveloperAgent",
    "ReviewerAgent",
  ]);
  expect(retries).toHaveLength(1);
  expect(prompts).toHaveLength(1);
});

test("gives a silent developer one finalization prompt", async () => {
  const calls: string[] = [];
  runAgent = async (agentClass) => {
    calls.push(agentClass.name);
    return fakeAgent(agentClass.name);
  };

  expect(await run()).toBe("incomplete");
  expect(calls).toEqual(["DeveloperAgent"]);
  expect(retries).toHaveLength(1);
  expect(prompts[0]).toContain('update_story_status with "implemented"');
});

test("classifies unverifiable browser testing as infrastructure", async () => {
  runAgent = async (
    agentClass,
    _workspace,
    _model,
    _config,
    repo,
    _events,
    _summary,
    id,
  ) => {
    if (agentClass.name === "DeveloperAgent") {
      await repo.updateStoryStatus(id, "in_progress");
      await repo.updateStoryStatus(id, "implemented");
    } else if (agentClass.name === "ReviewerAgent") {
      await repo.updateValidationResult(id, { score: 100, note: "" }, "review");
      await repo.updateStoryStatus(id, "approved");
    } else {
      await repo.updateValidationResult(
        id,
        { score: -1, note: "browser unavailable" },
        "test",
      );
    }
    return fakeAgent(agentClass.name);
  };

  expect(await run()).toBe("infrastructure");
});
