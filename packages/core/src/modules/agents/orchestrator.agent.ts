import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { z } from "zod";
import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { Config } from "../model/config.model.ts";
import { DeveloperAgent } from "./developer.agent.ts";
import { ReviewerAgent } from "./reviewer.agent.ts";
import { TesterAgent } from "./tester.agent.ts";
import type { ModelProvider } from "../model/providers/modelProvider.model.ts";
import type { Story } from "../model/story.model.ts";
import type { Workspace } from "../model/workspace.model.ts";
import { STORIES_PATH } from "../tools/registry.ts";
import { toolResult } from "../tools/story/stories.ts";

const orchestrationParamsSchema = z.object({
  agent: z.enum(["developer", "reviewer", "tester"]),
  storyId: z.number().int().positive(),
});

const agentClasses = {
  developer: DeveloperAgent,
  reviewer: ReviewerAgent,
  tester: TesterAgent,
} as const;
type AgentRole = keyof typeof agentClasses;

function expectedAgent(
  story: Story,
  config: Config,
  lastAgent: AgentRole | undefined,
): AgentRole | null {
  if (
    lastAgent === "reviewer" &&
    story.status === "approved" &&
    config.testerEnabled
  ) {
    return "tester";
  }
  if (
    (lastAgent === "reviewer" && story.status === "implemented") ||
    (lastAgent === "tester" && story.status === "approved")
  ) {
    return "developer";
  }
  if (story.status === "todo" || story.status === "in_progress") {
    return "developer";
  }
  if (config.reviewerEnabled && story.status === "implemented") {
    return "reviewer";
  }
  if (
    config.testerEnabled &&
    story.status === (config.reviewerEnabled ? "approved" : "implemented")
  ) {
    return "tester";
  }
  return null;
}

export class OrchestratorAgent extends Agent {
  readonly name = "orchestrator";
  readonly tools = ["read", "bash", "ls"] as const;

  private readonly config: Config;
  private readonly storiesPath: string;
  private readonly iterations = new Map<number, number>();
  private readonly lastAgents = new Map<number, AgentRole>();

  constructor(
    workspace: Workspace,
    modelProvider: ModelProvider,
    config: Config,
    stories: readonly Story[],
    runId: string,
    dependencies: AgentContext,
  ) {
    const terminal = config.terminalStatus;
    const available = stories
      .map((story) => `#${story.id} ${story.title} (status: ${story.status})`)
      .join("\n");
    super({
      runId,
      workspace,
      modelProvider,
      ...dependencies,
      timeoutMinutes: config.timeoutMinutes,
      systemPrompt: `## Role
Drive every story in stories.json to terminal status "${terminal}" by selecting its next agent.

## Current stories
${available}

## Lifecycle
- "todo" → developer → "implemented"
${config.reviewerEnabled ? `- "implemented" → reviewer → "approved" at score ${config.minScore}+` : "- Reviewer disabled."}
${config.testerEnabled ? `- "approved" (or "implemented" without review) → tester → "tested" at score ${config.minScore}+` : "- Tester disabled."}
- Each story has ${config.maxIterations} attempts; an exhausted final gate is blocked automatically.

## Process
1. Read ${resolve(workspace.workspaceDir, STORIES_PATH)} and select an unfinished story whose blockers are "${terminal}".
2. Call run_agent exactly once for its expected next agent. Never skip developer, review when enabled, or testing when enabled.
3. Re-read stories.json after every call. Never run terminal, blocked, dependency-blocked, or wrong-state stories.
4. Finish with one line: completed, blocked, and unresolved stories.`,
      userPrompt: `Read stories.json and orchestrate the remaining stories to completion.`,
    });
    this.config = config;
    this.storiesPath = resolve(workspace.workspaceDir, STORIES_PATH);
    this.dependencies = dependencies;
  }

  private readonly dependencies: AgentContext;

  protected override buildCustomTools(): ToolDefinition[] {
    return [...super.buildCustomTools(), this.runAgentTool()];
  }

  private runAgentTool(): ToolDefinition {
    return {
      name: "run_agent",
      label: "Run one agent",
      description:
        "Run exactly one agent (developer, reviewer, or tester) for one story, then report its updated status and scores. Use one call per step.",
      parameters: z.toJSONSchema(orchestrationParamsSchema),
      execute: async (
        _toolCallId: string,
        params: z.infer<typeof orchestrationParamsSchema>,
      ) => {
        const parsed = orchestrationParamsSchema.safeParse(params);
        if (!parsed.success) {
          return toolResult(`Error: ${parsed.error.issues[0]?.message}`);
        }
        const { agent, storyId } = parsed.data;
        const state = await this.dependencies.storyStore.read();
        const story = state?.stories.find((item) => item.id === storyId);
        if (!state || !story) return toolResult(`Story ${storyId} not found`);
        if (
          story.status === "blocked" ||
          story.status === this.config.terminalStatus
        ) {
          return toolResult(
            `Story ${storyId} cannot run from status "${story.status}"`,
          );
        }
        if (
          story.blockedBy.some(
            (dependencyId) =>
              state.stories.find((item) => item.id === dependencyId)?.status !==
              this.config.terminalStatus,
          )
        ) {
          return toolResult(
            `Story ${storyId} is blocked by unfinished dependencies`,
          );
        }
        const lastAgent = this.lastAgents.get(storyId);
        const expected = expectedAgent(story, this.config, lastAgent);
        if (expected !== agent) {
          return toolResult(
            `Story ${storyId} expects ${expected ?? "no agent"}, not ${agent}`,
          );
        }

        const iteration = (this.iterations.get(storyId) ?? 0) + 1;
        if (iteration > this.config.maxIterations) {
          await this.blockStory(storyId);
          return toolResult(
            `Story ${storyId} blocked after exhausting its iteration budget`,
          );
        }
        this.iterations.set(storyId, iteration);

        await new agentClasses[agent](
          storyId,
          this.storiesPath,
          this.workspace,
          this.modelProvider,
          this.config.timeoutMinutes,
          this.runId,
          this.dependencies,
        ).run(storyId, iteration, this.abortSignal);
        this.lastAgents.set(storyId, agent);

        const updatedState = await this.dependencies.storyStore.read();
        const updatedStory = updatedState?.stories.find(
          (item) => item.id === storyId,
        );
        if (!updatedStory)
          return toolResult(`Story ${storyId} not found after run`);
        return toolResult(
          `Story ${storyId} after ${agent} (iteration ${iteration}): ` +
            `status "${updatedStory.status}", reviewScore ${updatedStory.reviewResult.score}, testScore ${updatedStory.testResult.score}`,
        );
      },
    };
  }

  private async blockStory(storyId: number): Promise<void> {
    if (
      !(await this.dependencies.storyStore.block(
        storyId,
        this.config.terminalStatus,
      ))
    )
      return;
    this.dependencies.messagePublisher.publish({
      type: "story_blocked",
      runId: this.runId,
      storyId,
      detail: "iteration budget exhausted without reaching the terminal status",
      timestamp: new Date().toISOString(),
    });
  }
}
