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
import type { WorkflowAgentFactory } from "../../modules/model/workflowAgentFactory.model.ts";
import { StoryRunner } from "../storyRunner.ts";
import { slugify, WorkflowService } from "../workflow.ts";

const DEFAULT_OUTPUT_ROOT = resolve(import.meta.dirname, "../../../../../output");

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

}

// a product owner that outlives the run budget, so the deadline is what ends
// the run rather than the agent's own timeout.
class HangingAgentFactory extends TestAgentFactory {
  override createProductOwner(
    options: Parameters<WorkflowAgentFactory["createProductOwner"]>[0],
  ) {
    return {
      run: async (
        _storyId?: number,
        _iteration?: number,
        signal?: AbortSignal,
      ): Promise<void> =>
        new Promise<void>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("not reached")), 30_000);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("aborted"),
              );
            },
            { once: true },
          );
        }),
    };
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

it("ends a run that outlives its budget as a timeout, not a cancellation", async () => {
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
    agentFactory: new HangingAgentFactory(),
  });

  try {
    assert.equal(
      await workflow.run(
        Config.from({
          request: "run budget ceiling",
          reviewerEnabled: false,
          testerEnabled: false,
          maxIterations: 1,
          maxRunMinutes: 0.02,
        }),
        `deadline-${crypto.randomUUID()}`,
      ),
      true,
    );

    const status = events.find(
      (message) => message.type === "run_status" && message.status === "failed",
    );
    assert.equal(status?.type, "run_status");
    assert.equal(status?.outcome, "timeout");
    assert.match(status?.error ?? "", /exceeded the 0\.02 minute budget/);
  } finally {
    eventBus.unsubscribe(subscriber);
    // the failed run still wrote a run directory. left behind, it accumulates
    // and reclassifyRuns.ts counts these fixtures as real runs.
    await rm(resolve(DEFAULT_OUTPUT_ROOT, slugify("run budget ceiling")), {
      recursive: true,
      force: true,
    });
  }
}, 20_000);

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
