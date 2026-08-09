import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STORIES_PATH } from "./models/agents.ts";
import { ProductOwnerAgent } from "./agents/po.ts";
import { runStory } from "./loop/loop.ts";
import { writeStatus } from "./logging/log.ts";
import { RunTimer } from "./models/timer.ts";
import type { Workspace } from "./models/workspace.ts";
import { readStories, writeStoriesFile } from "./tools/stories.ts";
import { createOllamaRuntime } from "./utils/ollama.ts";

const OUTPUT_ROOT = fileURLToPath(new URL("../../../output", import.meta.url));

async function createRunDirectory(): Promise<Workspace> {
  const timestamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Berlin" })
    .replace(" ", "T")
    .replaceAll(":", "-");
  const runDir = resolve(OUTPUT_ROOT, timestamp);

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

async function main(): Promise<void> {
  const userRequest = Deno.args.join(" ") ||
    "Build an interactive web todo app.";
  const workspace = await createRunDirectory();
  const runtime = await createOllamaRuntime();
  const storiesPath = resolve(workspace.workspaceDir, STORIES_PATH);
  const timer = new RunTimer();

  await new ProductOwnerAgent(userRequest, STORIES_PATH).run(
    workspace,
    runtime,
    timer,
  );

  const initialState = await readStories(storiesPath);
  if (initialState === null) {
    writeStatus(
      `\n=== Run blocked in ${timer.formatElapsed()} ===\nProduct Owner failed: ${initialState}\n`,
    );
    return;
  }
  let stories = initialState.stories;

  while (stories.some((story) => story.status === "todo")) {
    const story = stories.find(
      (candidate) =>
        candidate.status === "todo" &&
        candidate.blockedBy.every(
          (dependency) =>
            stories.find((item) => item.id === dependency)?.status === "tested",
        ),
    );
    if (!story) {
      writeStatus(
        `\n=== Run incomplete in ${timer.formatElapsed()} ===\nRemaining stories wait on untested dependencies\n`,
      );
      return;
    }
    await runStory(story.id, workspace, runtime, timer);
    const freshState = await readStories(storiesPath);
    if (freshState === null) {
      writeStatus(
        `\n=== Run blocked in ${timer.formatElapsed()} ===\nstories.json invalid\n`,
      );
      return;
    }
    stories = freshState.stories;
  }

  if (stories.every((story) => story.status === "tested")) {
    writeStatus(
      `\n=== Run completed in ${timer.formatElapsed()} ===\nOutput: ${workspace.workspaceDir}\n`,
    );
  } else {
    writeStatus(
      `\n=== Run incomplete in ${timer.formatElapsed()} ===\nOne or more stories were not tested\n`,
    );
  }
}

await main();
