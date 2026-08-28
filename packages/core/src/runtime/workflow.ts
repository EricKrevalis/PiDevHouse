import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  defaultConfig,
  STORIES_FILE,
  type Config,
} from "../modules/models/config.model";
import type { Path } from "typescript";
import { OllamaProvider } from "../modules/models/ollamaProvider.model";
import { ProductOwnerAgent } from "../modules/agents/po/po.agent";
import { StoryRepository } from "../modules/repository/story.repository";
import {
  serializeError,
  SummaryCollector,
  type OutcomeClass,
  type SerializedError,
} from "../modules/services/summaryCollector";
import { AgentEventBridge } from "../modules/services/agentEventBridge";
import { MessageBus } from "../modules/services/messageBus";
import type { Message } from "../modules/models/message.model";
import { runStory } from "./storyLoop";
import { startTimer } from "./timer";

export async function run(
  config: Config,
  request: string,
  onMessage?: (message: Message) => void,
  signal?: AbortSignal,
  workspaceOverride?: Path,
): Promise<boolean> {
  const timeoutSignal =
    config.runTimeoutSeconds && config.runTimeoutSeconds > 0
      ? AbortSignal.timeout(config.runTimeoutSeconds * 1000)
      : undefined;
  const runSignal = signal
    ? timeoutSignal
      ? AbortSignal.any([signal, timeoutSignal])
      : signal
    : timeoutSignal ?? new AbortController().signal;
  const workspace = workspaceOverride
    ? await prepareWorkspace(workspaceOverride)
    : await createRunDirectory(request, config.outputDir);
  const ollamaProvider = await OllamaProvider.create();
  const storyRepository = new StoryRepository(
    resolve(workspace, STORIES_FILE) as Path,
  );
  const messageBus = new MessageBus(workspace);
  if (onMessage) messageBus.subscribe(onMessage);
  const stopTimer = startTimer(messageBus);
  const eventBridge = new AgentEventBridge(messageBus);
  const summaryCollector = new SummaryCollector();
  const startedAt = new Date();
  let error: SerializedError | undefined;
  let outcome: OutcomeClass = "completed";
  const runProductOwner = async () => {
    const productOwner = new ProductOwnerAgent(
      request,
      workspace,
      ollamaProvider,
      config,
      storyRepository,
      eventBridge,
      summaryCollector,
    );
    await productOwner.run(undefined, undefined, runSignal);
  };

  try {
    const gpuWarning = await ollamaProvider.preflight(runSignal);
    if (gpuWarning) {
      messageBus.publish({
        type: "warning",
        message: gpuWarning,
        timestamp: new Date().toISOString(),
      });
    }
    await runProductOwner();

    if (storyRepository.getStories().length === 0) {
      eventBridge.retry(
        { agent: "productOwner" },
        "No stories were created.",
      );
      await runProductOwner();
    }

    if (storyRepository.getStories().length === 0) {
      outcome = "incomplete";
      return false;
    }

    messageBus.publish({
      type: "run_info",
      totalStories: storyRepository.getStories().length,
      timestamp: new Date().toISOString(),
    });

    while (storyRepository.getStories().some((s) => s.status !== "tested")) {
      const story = storyRepository.getReadyStory();
      if (!story) {
        outcome = "no_ready";
        break;
      }
      const storyOutcome = await runStory(
        config,
        story,
        workspace,
        ollamaProvider,
        storyRepository,
        eventBridge,
        summaryCollector,
        runSignal,
      );
      if (storyOutcome !== "completed") {
        outcome = storyOutcome;
        break;
      }
    }
  } catch (err) {
    const timedOut = timeoutSignal
      ? runSignal.reason === timeoutSignal.reason
      : false;
    outcome = runSignal.aborted
      ? timedOut
        ? "timeout"
        : "cancelled"
      : "error";
    error = serializeError(runSignal.aborted ? runSignal.reason : err);
    if (runSignal.aborted && timedOut) {
      error.message = `Run exceeded ${config.runTimeoutSeconds}s time budget`;
    }
    if (runSignal.aborted && runSignal.reason !== err && !error.cause) {
      error.cause = serializeError(err);
    }
    throw err;
  } finally {
    stopTimer();
    await summaryCollector.writeSummary(workspace, {
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: Math.floor(
        (Date.now() - startedAt.getTime()) / 1000,
      ),
      outcome,
      error,
      request,
      stories: storyRepository.getStories(),
    });
  }

  return outcome === "completed";
}

export async function main(
  request: string,
  onMessage?: (message: Message) => void,
  signal?: AbortSignal,
  config: Config = defaultConfig,
): Promise<boolean> {
  return run(config, request, onMessage, signal);
}

async function createRunDirectory(
  request: string,
  outputDir: Path,
): Promise<Path> {
  const timestamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Berlin" })
    .replace(" ", "T")
    .replaceAll(":", "-");
  const slug = slugify(request);
  return prepareWorkspace(resolve(outputDir, slug, timestamp) as Path);
}

/** Git identity so agents can commit; the run workspace starts as a fresh repo. */
function initGitRepo(workspace: Path): void {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: workspace, stdio: "ignore" });
  git(["init", "-q"]);
  git(["config", "user.email", "developer@concentus.local"]);
  git(["config", "user.name", "Developer"]);
}

async function prepareWorkspace(workspace: Path): Promise<Path> {
  const src = resolve(workspace, "src");
  const log = resolve(workspace, "log");
  const test = resolve(workspace, "test");

  await Promise.all([
    mkdir(src, { recursive: true }),
    mkdir(log, { recursive: true }),
    mkdir(test, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      resolve(src, "AGENTS.md"),
      `# Workspace notes

## Environment

- Use Bun. Run all tests with \`bun test test\`. Do not probe for or use Node, npm, or npx.
- The sandbox has network access. Add dependencies with \`bun install\` in the workspace root; \`package.json\` and \`node_modules\` live at the root and are importable from both \`src/\` and \`test/\`.
- \`log/\` is managed by the harness and read-only; commit with plain \`git\` (\`.git\` is in the workspace root).

## Learned notes

Add only new working commands or sandbox quirks below.`,
    ),
    writeFile(resolve(workspace, ".gitignore"), "log/\n"),
  ]);
  try {
    initGitRepo(workspace);
  } catch {
    // git unavailable — developer commits are best-effort
  }

  return workspace as Path;
}

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
