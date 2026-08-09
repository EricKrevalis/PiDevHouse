import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GuideAgent } from "../modules/agents/guide.agent.ts";
import { OrchestratorAgent } from "../modules/agents/orchestrator.agent.ts";
import { ProductOwnerAgent } from "../modules/agents/po.agent.ts";
import { AgentTimeoutError } from "../modules/model/agents/agent.model.ts";
import { Config } from "../modules/model/config.model.ts";
import type { ModelProvider } from "../modules/model/providers/modelProvider.model.ts";
import { OllamaProvider } from "../modules/model/providers/ollamaProvider.model.ts";
import type { Story } from "../modules/model/story.model.ts";
import type { OutcomeClass } from "../modules/model/summary.model.ts";
import type { Workspace } from "../modules/model/workspace.model.ts";
import { AgentEventService } from "../modules/service/agentEvent.service.ts";
import { STORIES_PATH } from "../modules/tools/registry.ts";
import { readStories } from "../modules/tools/story/stories.ts";
import { runStory } from "./orchestrator.ts";
import { SummaryCollector } from "./summaryCollector.ts";
import { Timer } from "./timer.ts";

const OUTPUT_ROOT = fileURLToPath(
  new URL("../../../../output", import.meta.url),
);

async function createRunDirectory(request: string): Promise<Workspace> {
  const timestamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Berlin" })
    .replace(" ", "T")
    .replaceAll(":", "-");
  const slug = request
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  const runDir = resolve(OUTPUT_ROOT, slug, timestamp);

  const workspaceDir = resolve(runDir, "src");
  const logDir = resolve(runDir, "log");
  const testDir = resolve(runDir, "test");

  await Promise.all([
    Deno.mkdir(workspaceDir, { recursive: true }),
    Deno.mkdir(logDir, { recursive: true }),
    Deno.mkdir(testDir, { recursive: true }),
  ]);

  return { logDir, workspaceDir, testDir };
}

export async function runWorkflow(config: Config): Promise<boolean> {
  const eventService = AgentEventService.getInstance();
  const summaryCollector = SummaryCollector.getInstance();
  summaryCollector.reset();
  const timer = new Timer();
  timer.start();
  const startedAt = new Date();

  let workspace: Workspace | undefined;
  let modelProvider: ModelProvider | undefined;
  let stories: Story[] = [];
  let outcome: OutcomeClass = "completed";
  let failed = false;
  let errorMessage: string | undefined;

  try {
    workspace = await createRunDirectory(config.request);
    modelProvider = await OllamaProvider.create(config);
    const storiesPath = resolve(workspace.workspaceDir, STORIES_PATH);

    const po = new ProductOwnerAgent(
      config.request,
      storiesPath,
      workspace,
      modelProvider,
      config.timeoutMinutes,
    );

    let initialState: { stories: Story[] } | null = null;
    // PO gets 1 retry
    for (let attempt = 0; attempt < 2 && initialState === null; attempt++) {
      if (attempt > 0) {
        eventService.emit(`\nProduct Owner retry ${attempt}\n`);
      }
      await po.run();
      initialState = await readStories(storiesPath);
    }

    if (initialState === null) {
      outcome = "incomplete";
      failed = true;
      eventService.emit(
        `\nProduct Owner failed: stories.json missing or invalid\n`,
      );
    } else if (config.orchestratorEnabled) {
      eventService.setStoryCount(initialState.stories.length);
      await new OrchestratorAgent(
        workspace,
        modelProvider,
        config,
        initialState.stories,
      ).run();
      const finalState = await readStories(storiesPath);
      if (finalState === null) {
        outcome = "incomplete";
        failed = true;
        eventService.emit(`\n=== Run blocked ===\nstories.json invalid\n`);
      } else {
        stories = finalState.stories;
        if (stories.every((story) => story.status === config.terminalStatus)) {
          eventService.emit(
            `\n=== Run completed ===\nOutput: ${workspace.workspaceDir}\n`,
          );
          await new GuideAgent(workspace, modelProvider).run();
        } else {
          outcome = "incomplete";
          failed = true;
          eventService.emit(
            `\n=== Run incomplete ===\nOrchestrator did not deliver every story\n`,
          );
        }
      }
    } else {
      stories = initialState.stories;
      const terminal = config.terminalStatus;
      // ponytail: narrowing is lost inside closures in loops, so re-alias once
      const ws = workspace;
      const provider = modelProvider;

      eventService.setStoryCount(stories.length);

      while (stories.some((story) => story.status !== terminal)) {
        const ready = stories.filter(
          (story) =>
            story.status === "todo" &&
            story.blockedBy.every(
              (dependency) =>
                stories.find((item) => item.id === dependency)?.status ===
                terminal,
            ),
        );

        if (ready.length === 0) {
          outcome = "incomplete";
          failed = true;
          eventService.emit(
            `\n=== Run incomplete ===\nRemaining stories cannot make progress\n`,
          );
          break;
        }

        let index = 0;
        const workers = Math.min(config.concurrency, ready.length);
        // ponytail: shared-workspace parallel runs race on stories.json and file
        // edits; safe only for independent stories, default concurrency is 1
        await Promise.all(
          Array.from({ length: workers }, async () => {
            while (index < ready.length) {
              const storyId = ready[index++].id;
              await runStory(storyId, ws, provider, config);
            }
          }),
        );

        const freshState = await readStories(storiesPath);
        if (freshState === null) {
          outcome = "incomplete";
          failed = true;
          eventService.emit(`\n=== Run blocked ===\nstories.json invalid\n`);
          break;
        }
        stories = freshState.stories;
      }

      if (!failed) {
        eventService.emit(
          `\n=== Run completed ===\nOutput: ${workspace.workspaceDir}\n`,
        );
        await new GuideAgent(workspace, modelProvider).run();
      }
    }
  } catch (caught) {
    errorMessage = caught instanceof Error ? caught.message : String(caught);
    outcome = caught instanceof AgentTimeoutError ? "timeout" : "error";
    failed = true;
    eventService.emit(`\n=== Run failed (${outcome}) ===\n${errorMessage}\n`);
  } finally {
    timer.stop();
    if (workspace && modelProvider) {
      await summaryCollector.writeSummary(
        resolve(workspace.logDir, ".."),
        {
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
          durationSeconds: Math.floor(timer.elapsedMs() / 1000),
          outcome,
          request: config.request,
          model: modelProvider.model.id,
          config: config.toJson(),
          error: errorMessage,
          stories,
        },
      );
    }
  }
  return failed;
}
