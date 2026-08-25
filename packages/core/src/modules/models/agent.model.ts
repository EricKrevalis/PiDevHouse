import {
  DefaultResourceLoader,
  createAgentSession,
  SettingsManager,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { OllamaProvider } from "./ollamaProvider.model";
import type { Config } from "./config.model";
import type { AgentEventBridge } from "../services/agentEventBridge";
import type { SummaryCollector } from "../services/summaryCollector";
import type { StoryRepository } from "../repository/story.repository";
import { createSandboxedBashTool } from "../tools/bash";
import { scopeToolCalls } from "../tools/scope";
import type { Path } from "typescript";

export abstract class Agent {
  readonly name: string;
  readonly modelProvider: OllamaProvider;
  readonly systemPrompt: string;
  readonly userPrompts: string[];
  readonly workspace: string;
  readonly tools: string[] = [];
  readonly config: Config;
  readonly eventBridge: AgentEventBridge;
  readonly summaryCollector: SummaryCollector;
  readonly storyRepository: StoryRepository;
  private session?: AgentSession;

  constructor(params: {
    name: string;
    modelProvider: OllamaProvider;
    systemPrompt: string;
    userPrompts: string[];
    workspace: string;
    tools: string[];
    config: Config;
    eventBridge: AgentEventBridge;
    summaryCollector: SummaryCollector;
    storyRepository: StoryRepository;
  }) {
    const {
      name,
      modelProvider,
      systemPrompt,
      userPrompts,
      workspace,
      tools,
      config,
      eventBridge,
      summaryCollector,
      storyRepository,
    } = params;
    this.name = name;
    this.modelProvider = modelProvider;
    this.systemPrompt = systemPrompt;
    this.userPrompts = userPrompts;
    this.workspace = workspace;
    this.tools = tools;
    this.config = config;
    this.eventBridge = eventBridge;
    this.summaryCollector = summaryCollector;
    this.storyRepository = storyRepository;
  }

  abstract buildCustomTools(): ToolDefinition[];

  async run(
    storyId?: number,
    iteration?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.workspace,
      agentDir: this.workspace,
      systemPrompt: this.systemPrompt,
    });
    await resourceLoader.reload();

    const customTools = this.buildCustomTools();
    if (this.tools.includes("bash")) {
      customTools.push(createSandboxedBashTool(this.workspace) as ToolDefinition);
    }

    const { session } = await createAgentSession({
      cwd: this.workspace,
      model: this.modelProvider.model,
      modelRuntime: this.modelProvider.modelRuntime,
      thinkingLevel: "medium",
      tools: [...new Set([...this.tools, ...customTools.map((tool) => tool.name)])],
      customTools,
      resourceLoader: resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    });
    this.session = session;

    try {
      scopeToolCalls(
        session.agent,
        [resolve(this.workspace, "src"), resolve(this.workspace, "test")],
        this.config.maxToolCalls,
      );
      this.eventBridge.attach(session, {
        agent: this.name,
        storyId,
        iteration,
      });
      this.summaryCollector.attach(this, session, storyId, iteration);

      for (const prompt of this.userPrompts) {
        await this.prompt(prompt, signal);
      }
    } finally {
      await this.cleanup();
      session.dispose();
      if (this.session === session) this.session = undefined;
    }
  }

  protected async cleanup(): Promise<void> {}

  async prompt(prompt: string, signal?: AbortSignal): Promise<void> {
    const session = this.session;
    if (!session) return;

    const abort = () => void session.abort().catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      await session.prompt(prompt);
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}

export async function runAgent(
  agentClass: new (...args: any[]) => Agent,
  workspace: Path,
  modelProvider: OllamaProvider,
  config: Config,
  storyRepository: StoryRepository,
  eventBridge: AgentEventBridge,
  summaryCollector: SummaryCollector,
  storyId?: number,
  iteration?: number,
  signal?: AbortSignal,
): Promise<Agent> {
  const agent = new agentClass(
    storyId,
    workspace,
    modelProvider,
    config,
    storyRepository,
    eventBridge,
    summaryCollector,
  );
  await agent.run(storyId, iteration, signal);
  return agent;
}
