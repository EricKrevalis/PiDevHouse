import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentTimeoutError,
  type AgentContext,
} from "../modules/model/agents/agent.model.ts";
import { Config } from "../modules/model/config.model.ts";
import type { MessagePublisher } from "../modules/model/messagePublisher.model.ts";
import type { ModelProvider } from "../modules/model/providers/modelProvider.model.ts";
import type { Story } from "../modules/model/story.model.ts";
import type { OutcomeClass } from "../modules/model/summary.model.ts";
import type { Workspace } from "../modules/model/workspace.model.ts";
import type { WorkflowAgentFactory } from "../modules/model/workflowAgentFactory.model.ts";
import type { ModelProviderFactory } from "../modules/model/providers/modelProvider.model.ts";
import type { WorkflowRunner } from "../modules/model/workflowRunner.model.ts";
import { AgentEventBridge } from "../modules/service/agentEventBridge.ts";
import { SummaryCollector } from "../modules/service/summaryCollector.ts";
import { STORIES_PATH } from "../modules/tools/registry.ts";
import { StoryStore } from "../modules/tools/story/stories.ts";
import type { StoryRunner } from "./storyRunner.ts";
import { Timer } from "./timer.ts";

const DEFAULT_OUTPUT_ROOT = fileURLToPath(
  new URL("../../../../output", import.meta.url),
);

function outputRoot(): string {
  const subdir = process.env.PIDEV_OUTPUT_SUBDIR;
  if (subdir === undefined || subdir === "") return DEFAULT_OUTPUT_ROOT;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(subdir)) {
    throw new Error("PIDEV_OUTPUT_SUBDIR must be a single directory name");
  }
  return resolve(DEFAULT_OUTPUT_ROOT, subdir);
}

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

async function createRunDirectory(
  request: string,
  runId: string,
): Promise<Workspace> {
  const timestamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Berlin" })
    .replace(" ", "T")
    .replaceAll(":", "-");
  const slug = slugify(request);
  const runDir = resolve(
    outputRoot(),
    slug,
    `${timestamp}-${runId.slice(0, 8)}`,
  );

  const workspaceDir = resolve(runDir, "src");
  const logDir = resolve(runDir, "log");
  const testDir = resolve(runDir, "test");
  const sessionDir = resolve(runDir, "sessions");

  await Promise.all([
    mkdir(workspaceDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
    mkdir(testDir, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
  ]);

  return { logDir, workspaceDir, testDir, sessionDir };
}

type WorkflowDependencies = {
  messagePublisher: MessagePublisher;
  agentEventBridge: AgentEventBridge;
  storyRunner: StoryRunner;
  providerFactory: ModelProviderFactory;
  agentFactory: WorkflowAgentFactory;
};

type TerminalRunStatus =
  "completed" | "incomplete" | "blocked" | "failed" | "cancelled";

export class WorkflowService implements WorkflowRunner {
  constructor(private readonly dependencies: WorkflowDependencies) {}

  async run(
    config: Config,
    runId: string = crypto.randomUUID(),
    signal?: AbortSignal,
  ): Promise<boolean> {
    const cancellation = new AbortController();
    const forwardCancellation = (): void => {
      cancellation.abort(signal?.reason);
    };
    signal?.addEventListener("abort", forwardCancellation, { once: true });
    if (signal?.aborted) forwardCancellation();
    const workflowSignal = cancellation.signal;
    const summaryCollector = new SummaryCollector();
    const timer = new Timer(runId, this.dependencies.messagePublisher);
    timer.start();
    const startedAt = new Date();

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    if (config.timeoutMinutes > 0) {
      deadlineTimer = setTimeout(
        () =>
          cancellation.abort(new AgentTimeoutError(config.timeoutMinutes)),
        config.timeoutMinutes * 60_000,
      );
    }

    let workspace: Workspace | undefined;
    let modelProvider: ModelProvider | undefined;
    let storyStore: StoryStore | undefined;
    let stories: Story[] = [];
    let outcome: OutcomeClass = "completed";
    let failed = false;
    let errorMessage: string | undefined;
    let finalStatus: TerminalRunStatus = "completed";
    let finalDetail: string | undefined;

    try {
      workflowSignal.throwIfAborted();
      workspace = await createRunDirectory(config.request, runId);
      modelProvider = await this.dependencies.providerFactory.create(workflowSignal);
      workflowSignal.throwIfAborted();
      const storyFile = resolve(workspace.workspaceDir, STORIES_PATH);
      storyStore = new StoryStore(storyFile);
      const agentDependencies: AgentContext = {
        eventBridge: this.dependencies.agentEventBridge,
        summaryCollector,
        storyStore,
        messagePublisher: this.dependencies.messagePublisher,
      };

      const po = this.dependencies.agentFactory.createProductOwner({
        request: config.request,
        storiesPath: storyFile,
        workspace,
        modelProvider,
        timeoutMinutes: config.timeoutMinutes,
        runId,
        dependencies: agentDependencies,
      });

      let initialState: { stories: Story[] } | null = null;
      for (let attempt = 0; attempt < 2 && initialState === null; attempt++) {
        if (attempt > 0) {
          this.dependencies.messagePublisher.publish({
            type: "run_status",
            runId,
            status: "retry",
            attempt,
            timestamp: now(),
          });
        }
        await po.run(undefined, undefined, workflowSignal);
        initialState = await storyStore.read();
      }

      if (initialState === null) {
        outcome = "incomplete";
        failed = true;
        finalStatus = "failed";
        finalDetail = "Product Owner failed: stories.json missing or invalid";
      } else {
        this.dependencies.messagePublisher.publish({
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
            finalStatus = "incomplete";
            finalDetail = "Remaining stories cannot make progress";
            break;
          }

          for (const story of ready) {
            workflowSignal.throwIfAborted();
            await this.dependencies.storyRunner.run(
              story.id,
              ws,
              provider,
              config,
              runId,
              agentDependencies,
              workflowSignal,
            );
          }

          const freshState = await storyStore.read();
          if (freshState === null) {
            outcome = "incomplete";
            failed = true;
            finalStatus = "blocked";
            finalDetail = "stories.json invalid";
            break;
          }
          stories = freshState.stories;
        }

        if (!failed) {
          await this.dependencies.agentFactory
            .createGuide({
              workspace,
              modelProvider,
              runId,
              dependencies: agentDependencies,
            })
            .run(undefined, undefined, workflowSignal);
        }
      }
    } catch (caught) {
      if (storyStore !== undefined) {
        const latestState = await storyStore.read();
        if (latestState !== null) stories = latestState.stories;
      }
      errorMessage = caught instanceof Error ? caught.message : String(caught);
      outcome = signal?.aborted
        ? "cancelled"
        : caught instanceof AgentTimeoutError
          ? "timeout"
          : "error";
      failed = true;
      finalStatus = signal?.aborted ? "cancelled" : "failed";
    } finally {
      timer.stop();
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      try {
        if (workspace && modelProvider) {
          await summaryCollector.writeSummary(resolve(workspace.logDir, ".."), {
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            durationSeconds: Math.floor(timer.elapsedMs() / 1000),
            outcome,
            request: config.request,
            model: modelProvider.model.id,
            config: config.toJson(),
            error: errorMessage,
            stories,
          });
        }
      } catch (summaryError) {
        failed = true;
        finalStatus = "failed";
        outcome = "error";
        errorMessage =
          summaryError instanceof Error
            ? summaryError.message
            : String(summaryError);
        finalDetail = "Failed to write run summary";
      } finally {
        signal?.removeEventListener("abort", forwardCancellation);
      }
    }
    if (signal?.aborted && !failed) {
      failed = true;
      finalStatus = "cancelled";
      outcome = "cancelled";
      errorMessage = "Workflow cancelled";
    }
    this.dependencies.messagePublisher.publish({
      type: "run_status",
      runId,
      status: finalStatus,
      detail: finalDetail,
      outputDir:
        finalStatus === "completed" ? workspace?.workspaceDir : undefined,
      outcome: failed ? outcome : undefined,
      error: failed ? errorMessage : undefined,
      timestamp: now(),
    });
    return failed;
  }
}
