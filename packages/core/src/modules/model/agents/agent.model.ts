import {
  createAgentSession,
  type AgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentEventBridge } from "../../service/agentEventBridge.ts";
import type { SummaryCollector } from "../../service/summaryCollector.ts";
import { createCustomTools, toolName, ToolRef } from "../../tools/registry.ts";
import { describeSandbox, isInsideRoot } from "../../tools/bash.ts";
import type { StoryStore } from "../../tools/story/stories.ts";
import { scopeToolCalls, type WriteAccess } from "../../tools/scope.ts";
import type { MessagePublisher } from "../messagePublisher.model.ts";
import { ModelProvider } from "../providers/modelProvider.model.ts";
import { Workspace } from "../workspace.model.ts";

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
type ThinkingLevel = (typeof VALID_THINKING_LEVELS)[number];

function thinkingLevelFromEnv(): ThinkingLevel {
  const raw = process.env.THINKING_LEVEL;
  if (raw && (VALID_THINKING_LEVELS as readonly string[]).includes(raw)) {
    return raw as ThinkingLevel;
  }
  return "medium";
}

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
  sessionManager?: SessionManager;
}

export abstract class Agent {
  abstract readonly name: string;
  abstract readonly tools: readonly ToolRef[];
  readonly maxToolCalls: number = 25;
  readonly writeAccess: WriteAccess = "all";

  constructor(options: AgentOptions) {
    this.runId = options.runId;
    this.workspace = options.workspace;
    this.modelProvider = options.modelProvider;
    this.eventBridge = options.eventBridge;
    this.summaryCollector = options.summaryCollector;
    this.storyStore = options.storyStore;
    this.timeoutMinutes = options.timeoutMinutes ?? 0;
    this.sessionManager = options.sessionManager ?? SessionManager.inMemory();
    this.systemPrompt = options.systemPrompt;
    this.userPrompt = options.userPrompt;
  }

  readonly runId: string;
  readonly workspace: Workspace;
  readonly modelProvider: ModelProvider;
  readonly eventBridge: AgentEventBridge;
  readonly summaryCollector: SummaryCollector;
  readonly storyStore: StoryStore;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly timeoutMinutes: number;
  readonly sessionManager: SessionManager;

  protected buildCustomTools(): ReturnType<typeof createCustomTools> {
    return createCustomTools(this.tools, this.workspace, this.storyStore);
  }

  // optional prompt sections the base class appends after the agent's own prompt,
  // in one place so their text stays in sync with its source (the sandbox roots
  // plus denylist, the run's time budget). subclasses override to add
  // agent-specific blocks, e.g. a per-agent tool allowlist, via
  // `[...super.contextSections(), ...]`.
  protected contextSections(): string[] {
    const sections: string[] = [];
    if (this.tools.some((tool) => toolName(tool) === "bash")) {
      sections.push(describeSandbox(this.workspace));
    }
    if (this.timeoutMinutes > 0) {
      sections.push(
        `## Time budget\nYou have ${this.timeoutMinutes} minutes for this run. Do the highest-value work first and record your best result before the limit.`,
      );
    }
    return sections;
  }

  protected userPromptFor(iteration?: number): string {
    return [this.userPrompt, ...this.contextSections()].join("\n\n");
  }

  async run(
    storyId?: number,
    iteration?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const workspaceDir = this.workspace.workspaceDir;
    const resourceLoader = new DefaultResourceLoader({
      cwd: workspaceDir,
      agentDir: workspaceDir,
      systemPrompt: this.systemPrompt,
      // the loader walks every ancestor of cwd to the filesystem root for
      // AGENTS.md/CLAUDE.md. the workspace lives deep under the user's home, so
      // that walk drags in unrelated files (personal CLAUDE.md notes) worth
      // thousands of tokens. keep only the run's own src/AGENTS.md.
      agentsFilesOverride: ({ agentsFiles }) => ({
        agentsFiles: agentsFiles.filter((file) =>
          isInsideRoot(workspaceDir, file.path),
        ),
      }),
    });
    await resourceLoader.reload();
    signal?.throwIfAborted();

    const { session } = await createAgentSession({
      cwd: this.workspace.workspaceDir,
      model: this.modelProvider.model,
      modelRuntime: this.modelProvider.modelRuntime,
      thinkingLevel: thinkingLevelFromEnv(),
      tools: this.tools.map(toolName),
      customTools: this.buildCustomTools(),
      resourceLoader: resourceLoader,
      sessionManager: this.sessionManager,
      settingsManager: SettingsManager.inMemory(),
    });

    let promptCompleted = false;
    try {
      this.eventBridge.attach(this, session, storyId, iteration);
      this.summaryCollector.attach(this, session, storyId, iteration);
      scopeToolCalls(
        session.agent,
        [this.workspace.workspaceDir, this.workspace.testDir],
        this.maxToolCalls,
        this.writeAccess,
      );
      await this.prompt(session, iteration, signal);
      promptCompleted = true;
    } finally {
      if (!promptCompleted) {
        await session.abort().catch(() => {});
      }
      session.dispose();
    }
  }

  private async prompt(
    session: AgentSession,
    iteration: number | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const timeoutMinutes = this.timeoutMinutes;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const promptPromise = session.prompt(this.userPromptFor(iteration));
    promptPromise.catch(() => {});
    const waits: Array<Promise<unknown>> = [promptPromise];
    if (timeoutMinutes > 0) {
      waits.push(
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutMinutes * 60_000);
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
    if (timedOut) {
      await session.abort().catch(() => {});
      return;
    }
    await this.afterPrompt(session);
  }

  protected async afterPrompt(_session: AgentSession): Promise<void> {}
}
