import {
  createAgentSession,
  type AgentSession,
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
  timeoutMinutes?: number;
}

export class AgentTimeoutError extends Error {
  constructor(timeoutMinutes: number) {
    super(`Agent run exceeded ${timeoutMinutes} minute(s)`);
  }
}

export abstract class Agent {
  abstract readonly name: string;
  abstract readonly tools: readonly ToolRef[];

  constructor(options: AgentOptions) {
    this.workspace = options.workspace;
    this.modelProvider = options.modelProvider;
    this.timeoutMinutes = options.timeoutMinutes ?? 0;
    this.systemPrompt = this.withTimeoutPrompt(
      options.systemPrompt,
      this.timeoutMinutes,
    );
    this.userPrompt = options.userPrompt;
  }

  readonly workspace: Workspace;
  readonly modelProvider: ModelProvider;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly timeoutMinutes: number;

  protected get writeDir(): string {
    return this.workspace.workspaceDir;
  }

  private withTimeoutPrompt(prompt: string, timeoutMinutes: number): string {
    if (timeoutMinutes <= 0) return prompt;
    return `${prompt}\n\n## Timeout\nYou have ${timeoutMinutes} minute(s) for this run. Prioritize and finish within the limit; an unfinished run is a failure.`;
  }

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
      tools: this.tools.map(toolName),
      customTools: createCustomTools(this.tools, this.workspace, this.writeDir),
      resourceLoader: resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    });

    eventService.run(this, session, story, iteration);
    scopeToolCalls(session.agent, this.workspace.workspaceDir, this.writeDir);

    try {
      await this.prompt(session);
    } finally {
      session.dispose();
    }
  }

  private async prompt(session: AgentSession): Promise<void> {
    const timeoutMinutes = this.timeoutMinutes;
    if (timeoutMinutes <= 0) {
      await session.prompt(this.userPrompt);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AgentTimeoutError(timeoutMinutes)),
        timeoutMinutes * 60_000,
      );
    });
    const promptPromise = session.prompt(this.userPrompt);
    promptPromise.catch(() => {});
    try {
      await Promise.race([promptPromise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
