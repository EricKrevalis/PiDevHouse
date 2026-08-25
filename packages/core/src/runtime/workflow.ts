import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { STORIES_FILE, type Config } from "../modules/models/config.model";
import type { Path } from "typescript";
import { OllamaProvider } from "../modules/models/ollamaProvider.model";
import { ProductOwnerAgent } from "../modules/agents/po/po.agent";
import { StoryRepository } from "../modules/repository/story.repository";
import {
  SummaryCollector,
  type OutcomeClass,
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
): Promise<boolean> {
  const timeoutSignal = AbortSignal.timeout(config.runTimeoutSeconds * 1000);
  const runSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const workspace = await createRunDirectory(request, config.outputDir);
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
  let error: string | undefined;
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
    const gpuWarning = await ollamaProvider.warnIfNotOnGpu(runSignal);
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
    outcome = "error";
    error = err instanceof Error ? err.message : String(err);
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

async function createRunDirectory(
  request: string,
  outputDir: Path,
): Promise<Path> {
  const timestamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Berlin" })
    .replace(" ", "T")
    .replaceAll(":", "-");
  const slug = slugify(request);
  const workspace = resolve(outputDir, slug, timestamp);

  const src = resolve(workspace, "src");
  const log = resolve(workspace, "log");
  const test = resolve(workspace, "test");

  await Promise.all([
    mkdir(src, { recursive: true }),
    mkdir(log, { recursive: true }),
    mkdir(test, { recursive: true }),
  ]);
  await writeFile(
    resolve(src, "AGENTS.md"),
    `# Workspace notes

Shared environment lessons for every agent here: working commands, sandbox quirks, tool recipes.`,
  );

  return workspace as Path;
}

function slugify(request: string): string {
  return (
    request
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^\.+/, "")
      .slice(0, 30) || "request"
  );
}
