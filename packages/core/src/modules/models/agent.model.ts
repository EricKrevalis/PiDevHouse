import {
  DefaultResourceLoader,
  createAgentSession,
  SettingsManager,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { LlamaProvider } from "./llamaProvider.model";
import type { Config } from "./config.model";
import type { AgentEventBridge } from "../services/agentEventBridge";
import type { SummaryCollector } from "../services/summaryCollector";
import type { StoryRepository } from "../repository/story.repository";
import { createSandboxedBashTool } from "../tools/bash";
import { scopeToolCalls } from "../tools/scope";
import { trimToolOutputs } from "../tools/trim";
import type { Path } from "typescript";

export abstract class Agent {
  readonly name: string;
  readonly modelProvider: LlamaProvider;
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
    modelProvider: LlamaProvider;
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
    keepSession = false,
  ): Promise<void> {
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.workspace,
      agentDir: this.workspace,
      systemPrompt: this.systemPrompt,
    });
    await resourceLoader.reload();

    let completed = false;
    try {
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
      settingsManager: SettingsManager.inMemory({
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 1_000 },
      }),
      });
      this.session = session;

      scopeToolCalls(session.agent, this.workspace, this.config.maxToolCalls);
      trimToolOutputs(session.agent);
      this.eventBridge.attach(session, {
        agent: this.name,
        storyId,
        iteration,
      });
      this.summaryCollector.attach(this, session, storyId, iteration);

      for (const prompt of this.userPrompts) {
        await this.prompt(prompt, signal);
      }
      completed = true;
    } finally {
      if (!keepSession || !completed) await this.close();
    }
  }

  protected async cleanup(): Promise<void> {}

  async close(): Promise<void> {
    const session = this.session;

    await this.cleanup();
    if (!session) return;

    session.dispose();
    if (this.session === session) this.session = undefined;
  }

  async prompt(prompt: string, signal?: AbortSignal): Promise<void> {
    const session = this.session;
    if (!session) return;

    const abort = () => void session.abort().catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      await promptSession(session, prompt);
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}

export async function promptSession(
  session: { prompt(prompt: string): Promise<void> },
  prompt: string,
): Promise<void> {
  try {
    await session.prompt(prompt);
  } catch (error) {
    // a queued continuation can race the queue drain in pi-agent-core and
    // throw on the finished assistant turn; the transcript is intact, so a
    // fresh user message continues it cleanly
    if (
      !(error instanceof Error) ||
      !error.message.includes("Cannot continue from message role")
    ) {
      throw error;
    }
    await session.prompt(prompt);
  }
}

export async function runAgent(
  agentClass: new (...args: any[]) => Agent,
  workspace: Path,
  modelProvider: LlamaProvider,
  config: Config,
  storyRepository: StoryRepository,
  eventBridge: AgentEventBridge,
  summaryCollector: SummaryCollector,
  storyId?: number,
  iteration?: number,
  signal?: AbortSignal,
  keepSession = false,
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
  await agent.run(storyId, iteration, signal, keepSession);
  return agent;
}
