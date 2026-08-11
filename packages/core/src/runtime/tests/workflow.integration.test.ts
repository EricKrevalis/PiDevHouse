import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { it } from "vitest";
import { AgentEventBridge } from "../../modules/service/agentEventBridge.ts";
import {
  EventBus,
  type MessageSubscriber,
} from "../../modules/service/eventBus.service.ts";
import { Config } from "../../modules/model/config.model.ts";
import type { Message } from "../../modules/model/message.model.ts";
import type { ModelProvider } from "../../modules/model/providers/modelProvider.model.ts";
import type { ModelProviderFactory } from "../../modules/model/providers/modelProvider.model.ts";
import type { Story } from "../../modules/model/story.model.ts";
import type { StoryExecutor } from "../../modules/model/storyExecutor.model.ts";
import type { WorkflowAgentFactory } from "../../modules/model/workflowAgentFactory.model.ts";
import { StoryRunner } from "../orchestrator.ts";
import { WorkflowService } from "../workflow.ts";

function story(id = 1, status: Story["status"] = "implemented"): Story {
  return {
    id,
    title: "Integration story",
    description: "Complete the integration test story",
    acceptanceCriteria: ["The story is complete"],
    blockedBy: [],
    status,
    reviewResult: { score: 0, note: "" },
    testResult: { score: 0, note: "" },
  };
}

class TestAgentFactory implements WorkflowAgentFactory {
  constructor(private readonly stories = [story()]) {}

  createProductOwner(
    options: Parameters<WorkflowAgentFactory["createProductOwner"]>[0],
  ) {
    return {
      run: async () => options.dependencies.storyStore.write(this.stories),
    };
  }

  createGuide(options: Parameters<WorkflowAgentFactory["createGuide"]>[0]) {
    return {
      run: async () => {
        options.dependencies.messagePublisher.publish({
          type: "agent_end",
          runId: options.runId,
          agent: "guide",
          timestamp: new Date().toISOString(),
        });
      },
    };
  }

  createOrchestrator(
    _options: Parameters<WorkflowAgentFactory["createOrchestrator"]>[0],
  ) {
    return {
      run: async () => {
        throw new Error("orchestrator is not used in this test");
      },
    };
  }
}

class FailingStoryExecutor implements StoryExecutor {
  siblingCancelled = false;

  async run(
    storyId: number,
    _workspace: Parameters<StoryExecutor["run"]>[1],
    _modelProvider: Parameters<StoryExecutor["run"]>[2],
    _config: Parameters<StoryExecutor["run"]>[3],
    _runId: string,
    _dependencies: Parameters<StoryExecutor["run"]>[5],
    signal?: AbortSignal,
  ): Promise<void> {
    if (storyId === 1) throw new Error("worker failed");
    await new Promise<void>((resolve) => {
      const cancel = (): void => {
        this.siblingCancelled = true;
        resolve();
      };
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}

class TestProviderFactory implements ModelProviderFactory {
  async create(): Promise<ModelProvider> {
    return {
      model: { id: "test-model" },
      modelRuntime: {},
    } as ModelProvider;
  }
}

it("publishes completed only after the guide and summary finish", async () => {
  const eventBus = new EventBus();
  const events: Message[] = [];
  const subscriber: MessageSubscriber = {
    handle: (message) => events.push(message),
  };
  eventBus.subscribe(subscriber);
  const workflow = new WorkflowService({
    messagePublisher: eventBus,
    agentEventBridge: new AgentEventBridge(eventBus),
    storyRunner: new StoryRunner(eventBus),
    providerFactory: new TestProviderFactory(),
    agentFactory: new TestAgentFactory(),
  });
  const runId = `integration-${crypto.randomUUID()}`;

  try {
    assert.equal(
      await workflow.run(
        Config.from({
          request: "workflow completion ordering",
          reviewerEnabled: false,
          testerEnabled: false,
          maxIterations: 1,
        }),
        runId,
      ),
      false,
    );

    const guideIndex = events.findIndex(
      (message) => message.type === "agent_end" && message.agent === "guide",
    );
    const completedIndex = events.findIndex(
      (message) =>
        message.type === "run_status" && message.status === "completed",
    );
    assert.ok(guideIndex >= 0);
    assert.ok(completedIndex > guideIndex);

    const completed = events[completedIndex];
    assert.equal(completed.type, "run_status");
    assert.ok(completed.outputDir);
    assert.equal(
      existsSync(resolve(completed.outputDir!, "..", "summary.json")),
      true,
    );
  } finally {
    eventBus.unsubscribe(subscriber);
    const completed = events.find(
      (message) =>
        message.type === "run_status" && message.status === "completed",
    );
    if (completed?.type === "run_status" && completed.outputDir) {
      await rm(resolve(completed.outputDir, ".."), {
        recursive: true,
        force: true,
      });
    }
  }
});

it("cancels and awaits sibling story workers after one fails", async () => {
  const eventBus = new EventBus();
  const events: Message[] = [];
  const subscriber: MessageSubscriber = {
    handle: (message) => events.push(message),
  };
  eventBus.subscribe(subscriber);
  const storyExecutor = new FailingStoryExecutor();
  const workflow = new WorkflowService({
    messagePublisher: eventBus,
    agentEventBridge: new AgentEventBridge(eventBus),
    storyRunner: storyExecutor,
    providerFactory: new TestProviderFactory(),
    agentFactory: new TestAgentFactory([story(1, "todo"), story(2, "todo")]),
  });

  try {
    assert.equal(
      await workflow.run(
        Config.from({
          request: "worker cancellation",
          reviewerEnabled: false,
          testerEnabled: false,
          concurrency: 2,
          maxIterations: 1,
        }),
        `integration-${crypto.randomUUID()}`,
      ),
      true,
    );
    assert.equal(storyExecutor.siblingCancelled, true);
  } finally {
    eventBus.unsubscribe(subscriber);
    const failed = events.find(
      (message) => message.type === "run_status" && message.status === "failed",
    );
    if (failed?.type === "run_status" && failed.outputDir) {
      await rm(resolve(failed.outputDir, ".."), {
        recursive: true,
        force: true,
      });
    }
  }
});
