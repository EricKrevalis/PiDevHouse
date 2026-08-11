import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentTimeoutError } from "../modules/model/agents/agent.model.ts";
import { GuideAgent } from "../modules/agents/guide.agent.ts";
import { OrchestratorAgent } from "../modules/agents/orchestrator.agent.ts";
import { ProductOwnerAgent } from "../modules/agents/po.agent.ts";
import { Config } from "../modules/model/config.model.ts";
import type { ModelProvider } from "../modules/model/providers/modelProvider.model.ts";
import { OllamaProvider } from "../modules/model/providers/ollamaProvider.model.ts";
import type { Story } from "../modules/model/story.model.ts";
import type { OutcomeClass } from "../modules/model/summary.model.ts";
import type { Workspace } from "../modules/model/workspace.model.ts";
import { EventBus } from "../modules/service/eventBus.service.ts";
import { SummaryCollector } from "../modules/service/summaryCollector.ts";
import { STORIES_PATH } from "../modules/tools/registry.ts";
import { readStories } from "../modules/tools/story/stories.ts";
import { runStory } from "./orchestrator.ts";
import { Timer } from "./timer.ts";

const OUTPUT_ROOT = fileURLToPath(
  new URL("../../../../output", import.meta.url),
);

const now = (): string => new Date().toISOString();

export function slugify(request: string): string {
  return (
    request
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^\.+/, "")
      .slice(0, 30) || "request"
  );
}

async function createRunDirectory(request: string, runId: string): Promise<Workspace> {
  const timestamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Berlin" })
    .replace(" ", "T")
    .replaceAll(":", "-");
  const slug = slugify(request);
  const runDir = resolve(OUTPUT_ROOT, slug, `${timestamp}-${runId.slice(0, 8)}`);

  const workspaceDir = resolve(runDir, "src");
  const logDir = resolve(runDir, "log");
  const testDir = resolve(runDir, "test");

  await Promise.all([
    mkdir(workspaceDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
    mkdir(testDir, { recursive: true }),
  ]);

  return { logDir, workspaceDir, testDir };
}

export async function runWorkflow(
  config: Config,
  runId = crypto.randomUUID(),
): Promise<boolean> {
  const summaryCollector = SummaryCollector.getInstance();
  const timer = new Timer(runId);
  timer.start();
  const startedAt = new Date();

  let workspace: Workspace | undefined;
  let modelProvider: ModelProvider | undefined;
  let stories: Story[] = [];
  let outcome: OutcomeClass = "completed";
  let failed = false;
  let errorMessage: string | undefined;

  try {
    workspace = await createRunDirectory(config.request, runId);
    modelProvider = await OllamaProvider.create(config);
    const storyFile = resolve(workspace.workspaceDir, STORIES_PATH);

    const po = new ProductOwnerAgent(
      config.request,
      storyFile,
      workspace,
      modelProvider,
      config.timeoutMinutes,
      runId,
    );

    let initialState: { stories: Story[] } | null = null;
    // PO gets 1 retry
    for (let attempt = 0; attempt < 2 && initialState === null; attempt++) {
      if (attempt > 0) {
        EventBus.getInstance().publish({
          type: "run_status",
          runId,
          status: "retry",
          attempt,
          timestamp: now(),
        });
      }
      await po.run();
      initialState = await readStories(storyFile);
    }

    if (initialState === null) {
      outcome = "incomplete";
      failed = true;
      EventBus.getInstance().publish({
        type: "run_status",
        runId,
        status: "failed",
        detail: "Product Owner failed: stories.json missing or invalid",
        timestamp: now(),
      });
    } else if (config.orchestratorEnabled) {
      EventBus.getInstance().publish({
        type: "run_info",
        runId,
        totalStories: initialState.stories.length,
        timestamp: now(),
      });
      await new OrchestratorAgent(
        workspace,
        modelProvider,
        config,
        initialState.stories,
        runId,
      ).run();
      const finalState = await readStories(storyFile);
      if (finalState === null) {
        outcome = "incomplete";
        failed = true;
        EventBus.getInstance().publish({
          type: "run_status",
          runId,
          status: "blocked",
          detail: "stories.json invalid",
          timestamp: now(),
        });
      } else {
        stories = finalState.stories;
        if (stories.every((story) => story.status === config.terminalStatus)) {
          EventBus.getInstance().publish({
            type: "run_status",
            runId,
            status: "completed",
            outputDir: workspace.workspaceDir,
            timestamp: now(),
          });
          await new GuideAgent(
            workspace,
            modelProvider,
            runId,
          ).run();
        } else {
          outcome = "incomplete";
          failed = true;
          EventBus.getInstance().publish({
            type: "run_status",
            runId,
            status: "incomplete",
            detail: "Orchestrator did not deliver every story",
            timestamp: now(),
          });
        }
      }
    } else {
      EventBus.getInstance().publish({
        type: "run_info",
        runId,
        totalStories: initialState.stories.length,
        timestamp: now(),
      });
      stories = initialState.stories;
      const terminal = config.terminalStatus;
      const ws = workspace;
      const provider = modelProvider;

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
          EventBus.getInstance().publish({
            type: "run_status",
            runId,
            status: "incomplete",
            detail: "Remaining stories cannot make progress",
            timestamp: now(),
          });
          break;
        }

        let index = 0;
        const workers = Math.min(config.concurrency, ready.length);
        // ponytail: global story-file mutex; source-file conflicts remain possible
        // when parallel stories edit the same files; use isolated workspaces to fix
        await Promise.all(
          Array.from({ length: workers }, async () => {
            while (index < ready.length) {
              const storyId = ready[index++].id;
              await runStory(storyId, ws, provider, config, runId);
            }
          }),
        );

        const freshState = await readStories(storyFile);
        if (freshState === null) {
          outcome = "incomplete";
          failed = true;
          EventBus.getInstance().publish({
            type: "run_status",
            runId,
            status: "blocked",
            detail: "stories.json invalid",
            timestamp: now(),
          });
          break;
        }
        stories = freshState.stories;
      }

      if (!failed) {
        EventBus.getInstance().publish({
          type: "run_status",
          runId,
          status: "completed",
          outputDir: workspace.workspaceDir,
          timestamp: now(),
        });
        await new GuideAgent(
          workspace,
          modelProvider,
          runId,
        ).run();
      }
    }
  } catch (caught) {
    errorMessage = caught instanceof Error ? caught.message : String(caught);
    outcome = caught instanceof AgentTimeoutError ? "timeout" : "error";
    failed = true;
    EventBus.getInstance().publish({
      type: "run_status",
      runId,
      status: "failed",
      outcome,
      error: errorMessage,
      timestamp: now(),
    });
  } finally {
    timer.stop();
    if (workspace && modelProvider) {
      await summaryCollector.writeSummary(
        runId,
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
