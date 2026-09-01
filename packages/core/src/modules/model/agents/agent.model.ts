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

// a local model on a busy gpu needs longer than 90s to emit its closing write.
// raised after runs whose only failure was the finalize step timing out.
const FINALIZE_TIMEOUT_MS = 300_000;

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
type ThinkingLevel = (typeof VALID_THINKING_LEVELS)[number];

export function thinkingLevelFromEnv(): ThinkingLevel {
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

  // counted per invocation, read back in run()'s finally alongside the scope
  // guard's budget. lives on the instance because the sandbox reports denials
  // through a callback rather than through a tool result.
  private sandboxDenials = 0;

  protected buildCustomTools(): ReturnType<typeof createCustomTools> {
    return createCustomTools(this.tools, this.workspace, this.storyStore, () => {
      this.sandboxDenials += 1;
    });
  }

  // optional prompt sections the base class appends after the agent's own prompt,
  // in one place so their text stays in sync with its source (the sandbox roots
  // plus denylist, the run's time budget). subclasses override to add
  // agent-specific blocks, e.g. a per-agent tool allowlist, via
  // `[...super.contextSections(), ...]`.
  protected contextSections(iteration?: number): string[] {
    const sections: string[] = [];
    // iteration was accepted and thrown away, so the prompt on a fourth rework
    // pass was byte-identical to the first. every agent's "address the open
    // findings" instruction was conditional text the model had to infer applied.
    if (iteration !== undefined && iteration > 1) {
      sections.push(
        `## Rework pass\nThis is pass ${iteration} on this story; earlier passes did not clear it. The recorded findings are what remains open. Address those, and leave anything already accepted alone.`,
      );
    }
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
    return [this.userPrompt, ...this.contextSections(iteration)].join("\n\n");
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
      settingsManager: SettingsManager.inMemory({
        // transport-level retry for the ollama host, reached over tailscale.
        // a dropped request otherwise ends the invocation with no verdict.
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 1_000 },
      }),
    });

    let promptCompleted = false;
    this.sandboxDenials = 0;
    const budget = scopeToolCalls(
      session.agent,
      [this.workspace.workspaceDir, this.workspace.testDir],
      this.maxToolCalls,
      this.writeAccess,
    );
    try {
      this.eventBridge.attach(this, session, storyId, iteration);
      this.summaryCollector.attach(this, session, storyId, iteration);
      await this.prompt(session, iteration, signal);
      promptCompleted = true;
    } finally {
      // read after the turn ends so the counts cover the whole invocation,
      // including anything afterPrompt did.
      this.summaryCollector.noteToolCallBudget(this.name, {
        ...budget,
        sandboxDenials: this.sandboxDenials,
      });
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
    }
    await this.finalize(session, signal);
  }

  // the closing verdict write, on every path out of the turn.
  //
  // afterPrompt issues a second full model turn for the gate agents, and
  // session.prompt() takes neither a timeout nor a signal, so on its own it is
  // unbounded. the timeout path always knew that and raced it; the success path
  // did not, and by the time it ran, the invocation timer had been cleared and
  // the abort listener removed, leaving a nudge that nothing could stop. a
  // stalled host there hung the whole run past maxRunMinutes, since the run
  // deadline aborts a signal nobody was listening to any more.
  //
  // so both paths come through here: bounded by FINALIZE_TIMEOUT_MS, and
  // cancellable. whoever wins, the session is aborted before the caller
  // disposes it, or the request keeps running against ollama and holds a slot
  // the next agent in the loop needs.
  private async finalize(
    session: AgentSession,
    signal?: AbortSignal,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    let settledCleanly = false;
    try {
      await Promise.race([
        this.afterPrompt(session)
          .then(() => {
            settledCleanly = true;
          })
          .catch(() => {
            // a failed nudge is still a finished one: nothing is in flight.
            settledCleanly = true;
          }),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, FINALIZE_TIMEOUT_MS);
        }),
        new Promise<void>((resolve) => {
          if (signal === undefined) return;
          if (signal.aborted) {
            resolve();
            return;
          }
          abortHandler = (): void => resolve();
          signal.addEventListener("abort", abortHandler, { once: true });
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (signal !== undefined && abortHandler !== undefined) {
        signal.removeEventListener("abort", abortHandler);
      }
      if (!settledCleanly) await session.abort().catch(() => {});
    }
  }

  protected async afterPrompt(_session: AgentSession): Promise<void> {}
}
