import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type { AgentContext } from "../../modules/model/agents/agent.model.ts";
import { Config } from "../../modules/model/config.model.ts";
import type { Message } from "../../modules/model/message.model.ts";
import type { ModelProvider } from "../../modules/model/providers/modelProvider.model.ts";
import type { Story } from "../../modules/model/story.model.ts";
import type { Workspace } from "../../modules/model/workspace.model.ts";
import { StoryStore } from "../../modules/tools/story/stories.ts";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: { create: () => ({}), inMemory: () => ({}) },
}));

const mocks = vi.hoisted(() => ({ testerSilent: false }));

vi.mock("../../modules/agents/developer.agent.ts", () => ({
  DeveloperAgent: class {
    async run(): Promise<void> {}
  },
}));

vi.mock("../../modules/agents/reviewer.agent.ts", () => ({
  ReviewerAgent: class {
    constructor(
      private readonly storyId: number,
      _storiesPath: string,
      _workspace: unknown,
      _modelProvider: unknown,
      _config: unknown,
      _runId: string,
      private readonly dependencies: AgentContext,
      sessionManager?: unknown,
    ) {
      if (sessionManager !== undefined) {
        throw new Error("reviewer must run in a fresh session");
      }
    }

    async run(): Promise<void> {
      const state = await this.dependencies.storyStore.read();
      await this.dependencies.storyStore.write(
        (state?.stories ?? []).map((story) =>
          story.id === this.storyId
            ? { ...story, reviewResult: { score: 100, note: "clean" } }
            : story,
        ),
      );
    }
  },
}));

vi.mock("../../modules/agents/tester.agent.ts", () => ({
  TesterAgent: class {
    constructor(
      private readonly storyId: number,
      _storiesPath: string,
      _workspace: unknown,
      _modelProvider: unknown,
      _config: unknown,
      _runId: string,
      private readonly dependencies: AgentContext,
      sessionManager?: unknown,
    ) {
      if (sessionManager !== undefined) {
        throw new Error("tester must run in a fresh session");
      }
    }

    async run(): Promise<void> {
      if (mocks.testerSilent) return;
      const state = await this.dependencies.storyStore.read();
      await this.dependencies.storyStore.write(
        (state?.stories ?? []).map((story) =>
          story.id === this.storyId
            ? { ...story, testResult: { score: 100, note: "all criteria passed" } }
            : story,
        ),
      );
    }
  },
}));

import { StoryRunner, trackPlateau } from "../storyRunner.ts";

it("blocks after two consecutive non-improving failing scores", () => {
  let state: { best: number; flat: number; plateau: boolean } = { best: -Infinity, flat: 0, plateau: false };
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, true);
});

it("resets when the failing score improves and passes never plateau", () => {
  let state: { best: number; flat: number; plateau: boolean } = { best: -Infinity, flat: 0, plateau: false };
  state = trackPlateau(60, 75, state);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(80, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, false);
  state = trackPlateau(70, 75, state);
  assert.equal(state.plateau, true);
});

it("treats unverifiable (-1) scores as failing and plateaus like any score", () => {
  let state: { best: number; flat: number; plateau: boolean } = { best: -Infinity, flat: 0, plateau: false };
  state = trackPlateau(-1, 75, state);
  state = trackPlateau(-1, 75, state);
  state = trackPlateau(-1, 75, state);
  assert.equal(state.plateau, true);
});

function story(id: number): Story {
  return {
    id,
    title: "Story",
    description: "desc",
    acceptanceCriteria: ["criterion"],
    blockedBy: [],
    status: "implemented",
    reviewResult: { score: 0, note: "" },
    testResult: { score: 0, note: "" },
  };
}

async function testContext(): Promise<{
  dependencies: AgentContext;
  storyStore: StoryStore;
  workspace: Workspace;
}> {
  const dir = await mkdtemp(join(tmpdir(), "pidev-"));
  const storyStore = new StoryStore(join(dir, "stories.json"));
  await storyStore.write([story(1)]);
  const workspace: Workspace = {
    logDir: join(dir, "log"),
    workspaceDir: join(dir, "src"),
    testDir: join(dir, "test"),
  };
  const dependencies: AgentContext = {
    eventBridge: {} as AgentContext["eventBridge"],
    summaryCollector: {
      noteBlocked: () => {},
    } as unknown as AgentContext["summaryCollector"],
    storyStore,
    messagePublisher: { publish: () => {} },
  };
  return { dependencies, storyStore, workspace };
}

const modelProvider = {
  model: { id: "test-model" },
  modelRuntime: {},
} as ModelProvider;

it("sets the terminal status when review passes and the tester is disabled", async () => {
  const { dependencies, storyStore, workspace } = await testContext();

  await new StoryRunner({ publish: () => {} }).run(
    1,
    workspace,
    modelProvider,
    Config.from({
      reviewerEnabled: true,
      testerEnabled: false,
      maxIterations: 1,
    }),
    "run",
    dependencies,
  );

  assert.equal((await storyStore.read())?.stories[0].status, "approved");
});

it("sets the terminal status when the test passes", async () => {
  const { dependencies, storyStore, workspace } = await testContext();

  await new StoryRunner({ publish: () => {} }).run(
    1,
    workspace,
    modelProvider,
    Config.from({
      reviewerEnabled: true,
      testerEnabled: true,
      maxIterations: 1,
    }),
    "run",
    dependencies,
  );

  assert.equal((await storyStore.read())?.stories[0].status, "tested");
});

it("blocks a silent tester on the budget without counting a plateau", async () => {
  const { dependencies, storyStore, workspace } = await testContext();
  const events: Message[] = [];
  const publish = (message: Message): void => {
    events.push(message);
  };
  const publishing: AgentContext = {
    ...dependencies,
    messagePublisher: { publish },
  };
  mocks.testerSilent = true;
  try {
    await new StoryRunner({ publish }).run(
      1,
      workspace,
      modelProvider,
      Config.from({
        reviewerEnabled: true,
        testerEnabled: true,
        maxIterations: 2,
      }),
      "run",
      publishing,
    );
  } finally {
    mocks.testerSilent = false;
  }

  assert.equal((await storyStore.read())?.stories[0].status, "blocked");
  const blocked = events.find((event) => event.type === "story_blocked");
  assert.match(blocked?.detail ?? "", /2 gate run\(s\) ended without a written verdict/);
});
