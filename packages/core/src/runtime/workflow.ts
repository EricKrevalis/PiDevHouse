import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GuideAgent } from "../modules/agents/guide.agent.ts";
import { ProductOwnerAgent } from "../modules/agents/po.agent.ts";
import { AgentEventService } from "../modules/service/agentEvent.service.ts";
import { OllamaProvider } from "../modules/model/providers/ollamaProvider.model.ts";
import type { Workspace } from "../modules/model/workspace.model.ts";
import { STORIES_PATH } from "../modules/tools/registry.ts";
import { readStories } from "../modules/tools/story/stories.ts";
import { runStories } from "./orchestrator.ts";
import { Story } from "../modules/model/story.model.ts";
import { Timer } from "./timer.ts";

const OUTPUT_ROOT = fileURLToPath(
  new URL("../../../../output", import.meta.url),
);

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

export async function runWorkflow(
  userRequest = Deno.args.join(" ") || "Build an interactive web todo app.",
): Promise<number> {
  const workspace = await createRunDirectory();
  const modelProvider = await OllamaProvider.create();
  const storiesPath = resolve(workspace.workspaceDir, STORIES_PATH);

  const timer = new Timer();
  timer.start();
  try {
    await new ProductOwnerAgent(
      userRequest,
      storiesPath,
      workspace,
      modelProvider,
    ).run();

    const initialState = await readStories(storiesPath);
    if (initialState === null) {
      AgentEventService.getInstance().emit(
        `\nProduct Owner failed: stories.json missing or invalid\n`,
      );
      return 1;
    }
    let stories = initialState.stories;

    while (stories.some((story) => story.status !== "tested")) {
      const story = stories.find(
        (candidate) =>
          candidate.status === "todo" &&
          candidate.blockedBy.every(
            (dependency: Story) =>
              // TODO this may be to strict
              stories.find((item) => item.id === dependency)?.status ===
              "tested",
          ),
      );

      if (!story) {
        AgentEventService.getInstance().emit(
          `\n=== Run incomplete ===\nRemaining stories wait on untested dependencies\n`,
        );
        return 1;
      }
      AgentEventService.getInstance().setStoryCount(stories.length);
      await runStories(story.id, workspace, modelProvider);
      const freshState = await readStories(storiesPath);
      if (freshState === null) {
        AgentEventService.getInstance().emit(
          `\n=== Run blocked ===\nstories.json invalid\n`,
        );
        return 1;
      }
      stories = freshState.stories;
    }

    if (stories.every((story) => story.status === "tested")) {
      AgentEventService.getInstance().emit(
        `\n=== Run completed ===\nOutput: ${workspace.workspaceDir}\n`,
      );
      await new GuideAgent(workspace, modelProvider).run();
      return 0;
    } else {
      AgentEventService.getInstance().emit(
        `\n=== Run incomplete     ===\nOne or more stories were not tested\n`,
      );
      return 1;
    }
  } finally {
    timer.stop();
  }
}
