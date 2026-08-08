import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { AgentEventService } from "../../service/agentEvent.service.ts";
import { createCustomTools, toolName, ToolRef } from "../../tools/registry.ts";
import { scopeToolCalls } from "../../tools/scope.ts";
import { ModelProvider } from "../providers/modelProvider.model.ts";
import { Workspace } from "../workspace.model.ts";

interface AgentOptions {
  workspace: Workspace;
  modelProvider: ModelProvider;
  systemPrompt: string;
  userPrompt: string;
}

export abstract class Agent {
  abstract readonly name: string;
  abstract readonly tools: readonly ToolRef[];

  constructor(options: AgentOptions) {
    this.workspace = options.workspace;
    this.modelProvider = options.modelProvider;
    this.systemPrompt = options.systemPrompt;
    this.userPrompt = options.userPrompt;
  }

  readonly workspace: Workspace;
  readonly modelProvider: ModelProvider;
  readonly systemPrompt: string;
  readonly userPrompt: string;

  async run(story?: number, iteration?: number): Promise<void> {
    const eventService = AgentEventService.getInstance();

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.workspace.workspaceDir,
      agentDir: this.workspace.workspaceDir,
      systemPrompt: this.systemPrompt,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: this.workspace.workspaceDir,
      model: this.modelProvider.model,
      modelRuntime: this.modelProvider.modelRuntime,
      thinkingLevel: "off",
      tools: this.tools.map(toolName),
      customTools: createCustomTools(this.tools, this.workspace.workspaceDir),
      resourceLoader: resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    });

    eventService.run(this, session, story, iteration);
    scopeToolCalls(session.agent, this.workspace.workspaceDir);

    try {
      await session.prompt(this.userPrompt);
    } catch (error) {
      throw error;
    } finally {
      session.dispose();
    }
  }
}
