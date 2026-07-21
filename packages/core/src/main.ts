import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Agent,
  createProductOwnerAgent,
  createStoryAgents,
  getStoryIds,
} from "./agents.ts";
import { createSandboxedBashTool } from "./tools/bash.ts";
import { scopeToolCalls } from "./tools/scope.ts";
import { createOllamaRuntime, ModelEnv } from "./utils/ollama.ts";

interface Workspace {
  logDir: string;
  workspaceDir: string;
}

const STORIES_PATH = "stories.json";
const OUTPUT_ROOT = fileURLToPath(new URL("../../../output", import.meta.url));
const textEncoder = new TextEncoder();

function writeOutput(message: string): void {
  Deno.stdout.writeSync(textEncoder.encode(message));
}

function writeStatus(message: string): void {
  Deno.stderr.writeSync(textEncoder.encode(message));
}

function formatToolDetails(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";

  const values = args as Record<string, unknown>;
  if (toolName === "bash" && typeof values.command === "string") {
    const command = values.command.slice(0, 500) +
      (values.command.length > 500 ? "..." : "");
    return `\n  $ ${command}`;
  }

  const path = values.path ?? values.file_path;
  return path ? `\n  path: ${path}` : "";
}

async function createRunDirectory(): Promise<Workspace> {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const runDir = resolve(OUTPUT_ROOT, timestamp);
  const workspaceDir = resolve(runDir, "src");
  const logDir = resolve(runDir, "log");
  await Promise.all([
    Deno.mkdir(workspaceDir, { recursive: true }),
    Deno.mkdir(logDir, { recursive: true }),
  ]);
  return { logDir, workspaceDir };
}

async function runAgent(
  agent: Agent,
  workspace: Workspace,
  modelEnv: ModelEnv,
  story?: number,
): Promise<void> {
  const storyMsg = story ? `[Story:${story}] ` : "";
  writeStatus(`\n=== ${storyMsg}${agent.name} ===\nStatus: starting\n`);

  const resourceLoader = new DefaultResourceLoader({
    cwd: workspace.workspaceDir,
    agentDir: workspace.workspaceDir,
    systemPrompt: agent.systemPrompt,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: workspace.workspaceDir,
    model: modelEnv.model,
    modelRuntime: modelEnv.modelRuntime,
    thinkingLevel: "off",
    tools: agent.tools,
    customTools: agent.tools.includes("bash")
      ? [
        createSandboxedBashTool(
          workspace.workspaceDir,
        ) as unknown as ToolDefinition,
      ]
      : [],
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
  });

  scopeToolCalls(session.agent, workspace.workspaceDir);

  let pendingLogWrite: Promise<void> = Promise.resolve();
  let responseStarted = false;
  session.subscribe((event) => {
    pendingLogWrite = pendingLogWrite.then(() =>
      Deno.writeTextFile(
        resolve(workspace.logDir, "outputlog.jsonl"),
        `${JSON.stringify(event)}\n`,
        { append: true },
      )
    );
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      if (!responseStarted) {
        writeOutput(`\n${storyMsg}${agent.name} response:\n\n`);
        responseStarted = true;
      }
      writeOutput(event.assistantMessageEvent.delta);
    } else if (event.type === "tool_execution_start") {
      writeStatus(
        `\n${storyMsg}[${agent.name}] [tool]: ${event.toolName}${
          formatToolDetails(
            event.toolName,
            event.args,
          )
        }\n`,
      );
    }
  });

  try {
    await session.prompt(agent.userPrompt);
    await pendingLogWrite;
    writeStatus(`\n${storyMsg}Status: ${agent.name} completed\n`);
  } finally {
    session.dispose();
  }
}

async function main(): Promise<void> {
  const userRequest = Deno.args.join(" ") ||
    "Build an interactive web todo app.";
  const workspace = await createRunDirectory();
  const runtime = await createOllamaRuntime();

  await runAgent(
    createProductOwnerAgent(userRequest, STORIES_PATH),
    workspace,
    runtime,
  );

  const storyIds = getStoryIds(
    await Deno.readTextFile(resolve(workspace.workspaceDir, STORIES_PATH)),
  );
  for (const storyId of storyIds) {
    for (const agent of createStoryAgents(storyId, STORIES_PATH)) {
      await runAgent(agent, workspace, runtime, storyId);
    }
  }

  writeStatus(`\n=== Run completed ===\nOutput: ${workspace.workspaceDir}\n`);
}

await main();
