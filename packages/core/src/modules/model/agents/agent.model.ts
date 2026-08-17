import {
  createAgentSession,
  type AgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentEventBridge } from "../../service/agentEventBridge.ts";
import type { SummaryCollector } from "../../service/summaryCollector.ts";
import {
  createCustomTools,
  toolName,
  ToolRef,
  TOOLS,
} from "../../tools/registry.ts";
import type { StoryStore } from "../../tools/story/stories.ts";
import { scopeToolCalls } from "../../tools/scope.ts";
import type { MessagePublisher } from "../messagePublisher.model.ts";
import { ModelProvider } from "../providers/modelProvider.model.ts";
import { Workspace } from "../workspace.model.ts";

export interface AgentContext {
  eventBridge: AgentEventBridge;
  summaryCollector: SummaryCollector;
  storyStore: StoryStore;
  messagePublisher: MessagePublisher;
}

interface AgentOptions extends AgentContext {
  runId: string;
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
    this.runId = options.runId;
    this.workspace = options.workspace;
    this.modelProvider = options.modelProvider;
    this.eventBridge = options.eventBridge;
    this.summaryCollector = options.summaryCollector;
    this.storyStore = options.storyStore;
    this.messagePublisher = options.messagePublisher;
    this.timeoutMinutes = options.timeoutMinutes ?? 0;
    this.systemPrompt = this.withTimeoutPrompt(
      options.systemPrompt,
      this.timeoutMinutes,
    );
    this.userPrompt = options.userPrompt;
  }

  readonly runId: string;
  readonly workspace: Workspace;
  readonly modelProvider: ModelProvider;
  readonly eventBridge: AgentEventBridge;
  readonly summaryCollector: SummaryCollector;
  readonly storyStore: StoryStore;
  readonly messagePublisher: MessagePublisher;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly timeoutMinutes: number;
  protected abortSignal: AbortSignal | undefined;

  protected get writeDir(): string {
    return this.workspace.workspaceDir;
  }

  protected get bashWriteDir(): string | undefined {
    return this.tools.some((ref) => {
      const name = toolName(ref);
      return name === TOOLS.write || name === TOOLS.edit;
    })
      ? this.writeDir
      : undefined;
  }

  protected buildCustomTools(): ReturnType<typeof createCustomTools> {
    return createCustomTools(
      this.tools,
      this.workspace,
      this.storyStore,
      this.writeDir,
      this.bashWriteDir,
    );
  }

  private withTimeoutPrompt(prompt: string, timeoutMinutes: number): string {
    if (timeoutMinutes <= 0) return prompt;
    return `${prompt}\n\n## Timeout\nYou have ${timeoutMinutes} minute(s) for this run. Prioritize and finish within the limit; an unfinished run is a failure.`;
  }

  async run(
    storyId?: number,
    iteration?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.abortSignal = signal;
    try {
      signal?.throwIfAborted();
      const resourceLoader = new DefaultResourceLoader({
        cwd: this.workspace.workspaceDir,
        agentDir: this.workspace.workspaceDir,
        systemPrompt: this.systemPrompt,
      });
      await resourceLoader.reload();
      signal?.throwIfAborted();

      const { session } = await createAgentSession({
        cwd: this.workspace.workspaceDir,
        model: this.modelProvider.model,
        modelRuntime: this.modelProvider.modelRuntime,
        tools: this.tools.map(toolName),
        customTools: this.buildCustomTools(),
        resourceLoader: resourceLoader,
        sessionManager: SessionManager.inMemory(),
        settingsManager: SettingsManager.inMemory(),
      });

      let promptCompleted = false;
      try {
        this.eventBridge.attach(this, session, storyId, iteration);
        this.summaryCollector.attach(this, session, storyId, iteration);
        scopeToolCalls(
          session.agent,
          this.workspace.workspaceDir,
          this.writeDir,
        );
        await this.prompt(session, signal);
        promptCompleted = true;
      } finally {
        if (!promptCompleted) {
          await session.abort().catch(() => {});
        }
        session.dispose();
      }
    } finally {
      this.abortSignal = undefined;
    }
  }

  private async prompt(
    session: AgentSession,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const timeoutMinutes = this.timeoutMinutes;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promptPromise = session.prompt(this.userPrompt);
    promptPromise.catch(() => {});
    const waits: Array<Promise<unknown>> = [promptPromise];
    if (timeoutMinutes > 0) {
      waits.push(
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new AgentTimeoutError(timeoutMinutes)),
            timeoutMinutes * 60_000,
          );
        }),
      );
    }
    let abortHandler: (() => void) | undefined;
    if (signal !== undefined) {
      waits.push(
        new Promise<never>((_, reject) => {
          abortHandler = (): void => {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error("Agent run cancelled"),
            );
          };
          signal.addEventListener("abort", abortHandler, { once: true });
        }),
      );
    }
    try {
      await Promise.race(waits);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (signal !== undefined && abortHandler !== undefined) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
}
