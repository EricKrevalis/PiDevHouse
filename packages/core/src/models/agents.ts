import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { RunTimer } from "./timer.ts";
import type { Workspace } from "./workspace.ts";
import type { ModelEnv } from "../utils/ollama.ts";
import { attachLogger, writeStatus } from "../logging/log.ts";
import { createSandboxedBashTool } from "../tools/bash.ts";
import { scopeToolCalls } from "../tools/scope.ts";
import { createWriteStoriesTool } from "../tools/stories.ts";

export const STORIES_PATH = "stories.json";

export abstract class Agent {
  abstract readonly name: string;
  abstract readonly systemPrompt: string;
  abstract readonly userPrompt: string;
  abstract readonly tools: string[];

  private customToolsFor(workspaceDir: string): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    if (this.tools.includes("bash")) {
      tools.push(
        createSandboxedBashTool(workspaceDir) as unknown as ToolDefinition,
      );
    }
    const storiesPath = resolve(workspaceDir, STORIES_PATH);
    if (this.tools.includes("write_stories")) {
      tools.push(
        createWriteStoriesTool(storiesPath) as unknown as ToolDefinition,
      );
    }
    return tools;
  }

  async run(
    workspace: Workspace,
    modelEnv: ModelEnv,
    timer: RunTimer,
    story?: number,
    iteration?: number,
  ): Promise<void> {
    const statusPrefix = () =>
      `[Elapsed:${timer.formatElapsed()}]${
        story === undefined
          ? ""
          : ` [Story:${story}]${
            iteration === undefined ? "" : ` [Iteration:${iteration}]`
          }`
      } `;
    writeStatus(`\n=== ${statusPrefix()}${this.name} ===\nStatus: starting\n`);

    const resourceLoader = new DefaultResourceLoader({
      cwd: workspace.workspaceDir,
      agentDir: workspace.workspaceDir,
      systemPrompt: this.systemPrompt,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: workspace.workspaceDir,
      model: modelEnv.model,
      modelRuntime: modelEnv.modelRuntime,
      thinkingLevel: "off",
      tools: this.tools,
      customTools: this.customToolsFor(workspace.workspaceDir),
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    });

    scopeToolCalls(session.agent, workspace.workspaceDir);

    const logger = attachLogger(
      session,
      workspace,
      statusPrefix,
      this.name,
      timer,
      story,
      iteration,
    );
    try {
      await session.prompt(this.userPrompt);
      logger.complete();
      writeStatus(`\n${statusPrefix()}Status: ${this.name} completed\n`);
    } catch (error) {
      logger.fail(error);
      throw error;
    } finally {
      await logger.flush();
      session.dispose();
    }
  }
}

export abstract class StoryAgent extends Agent {
  readonly userPrompt: string;

  constructor(
    readonly storyId: number,
    storiesPath: string,
    promptSubject: string,
  ) {
    super();
    this.userPrompt = `${promptSubject} story ${storyId} in ${storiesPath}.`;
  }
}
