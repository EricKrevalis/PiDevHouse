import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agent, promptSession } from "../../src/modules/models/agent.model";
import { LlamaProvider } from "../../src/modules/models/llamaProvider.model";
import { StoryRepository } from "../../src/modules/repository/story.repository";
import { SummaryCollector } from "../../src/modules/services/summaryCollector";
import { createUpdateStoryStatusTool } from "../../src/modules/tools/storys/updateStoryStatus";
import type { Config } from "../../src/modules/models/config.model";

const originalLlamaServer = process.env.LLAMA_SERVER;
const originalLlamaModel = process.env.LLAMA_MODEL;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-agent-"));
  await Promise.all([
    mkdir(join(directory, "src")),
    mkdir(join(directory, "test")),
    mkdir(join(directory, "log")),
  ]);
});

afterEach(async () => {
  if (originalLlamaServer === undefined) delete process.env.LLAMA_SERVER;
  else process.env.LLAMA_SERVER = originalLlamaServer;
  if (originalLlamaModel === undefined) delete process.env.LLAMA_MODEL;
  else process.env.LLAMA_MODEL = originalLlamaModel;
  await rm(directory, { recursive: true });
});

test("activates custom tools in a real Pi session", async () => {
  process.env.LLAMA_SERVER = "http://localhost:11434";
  process.env.LLAMA_MODEL = "test-model";
  const provider = await LlamaProvider.create();
  const repository = new StoryRepository(
    join(directory, "stories.json") as never,
  );
  let activeTools: string[] = [];
  let disposed = false;
  const eventBridge = {
    attach(session: {
      dispose: () => void;
      getActiveToolNames: () => string[];
    }) {
      activeTools = session.getActiveToolNames();
      const dispose = session.dispose.bind(session);
      session.dispose = () => {
        disposed = true;
        dispose();
      };
    },
  } as never;
  const config: Config = {
    outputDir: directory as never,
    maxIteration: 1,
    minScore: 60,
    maxToolCalls: 1,
    runTimeoutSeconds: 1,
  };

  class CustomToolAgent extends Agent {
    constructor() {
      super({
        name: "custom",
        modelProvider: provider,
        systemPrompt: "test",
        userPrompts: [],
        workspace: directory,
        tools: [],
        config,
        eventBridge,
        summaryCollector: new SummaryCollector(),
        storyRepository: repository,
      });
    }

    buildCustomTools() {
      return [createUpdateStoryStatusTool(repository)];
    }
  }

  const agent = new CustomToolAgent();
  await agent.run();
  expect(activeTools).toContain("update_story_status");
  expect(disposed).toBe(true);
  expect((agent as unknown as { session?: unknown }).session).toBeUndefined();
});

test("aborts an active Pi prompt", async () => {
  let releasePrompt: () => void = () => {};
  let aborts = 0;
  const session = {
    prompt: () =>
      new Promise<void>((resolve) => {
        releasePrompt = resolve;
      }),
    abort: async () => {
      aborts++;
      releasePrompt();
    },
  };
  const controller = new AbortController();

  const pending = Agent.prototype.prompt.call(
    { session },
    "test",
    controller.signal,
  );
  controller.abort();

  await expect(pending).rejects.toThrow();
  expect(aborts).toBe(1);
});

test("recovers when a queued continuation hits the assistant-role error", async () => {
  const prompts: string[] = [];
  const session = {
    prompt: async (prompt: string) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        throw new Error("Cannot continue from message role: assistant");
      }
      if (prompt === "other") {
        throw new Error("boom");
      }
    },
  };

  await promptSession(session, "retry");
  await expect(promptSession(session, "other")).rejects.toThrow("boom");
  expect(prompts).toEqual(["retry", "retry", "other"]);
});
