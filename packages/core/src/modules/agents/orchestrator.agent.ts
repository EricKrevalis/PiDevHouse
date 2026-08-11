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
You are the orchestration agent. You decide which agent runs next on which story. Drive every story in stories.json to the terminal status "${terminal}".

## Current stories
${available}

## Story lifecycle
- "todo" → run the developer agent to implement it (status becomes "in_progress" then "implemented").
${config.reviewerEnabled ? `- "implemented" → run the reviewer agent; it sets "approved" when reviewResult.score >= ${config.minScore}.` : "- The reviewer agent is disabled; skip it."}
${config.testerEnabled ? `- "approved" (or "implemented" when the reviewer is disabled) → run the tester agent; it sets "tested" when testResult.score >= ${config.minScore}.` : "- The tester agent is disabled; the terminal status is reached after review."}
- Each story has an iteration budget of ${config.maxIterations}. The run_agent tool reports how many iterations a story has used. When the budget is exhausted at the story's final gate without reaching "${terminal}", the story is marked "blocked" automatically; move on, it cannot be fixed by more iterations.

## Process
    1. Read ${resolve(workspace.workspaceDir, STORIES_PATH)} and inspect every story's status, scores, and blockedBy dependencies.
2. Only work on a story that is "todo" (or already in progress) and whose blockedBy stories all have status "${terminal}".
3. Call run_agent for exactly one agent on exactly one story at a time: the agent that should run next given the story's current status. Never skip a step: developer first, then reviewer (if enabled), then tester (if enabled).
4. After each run_agent, re-read stories.json and check the updated status and scores before choosing the next agent. Do not run an agent on a story whose current status does not match its expected input state.
5. Never run_agent for a story that already has status "${terminal}" or "blocked", and never run one whose dependencies are not all "${terminal}".

## Stop
Finish with a one-line summary: how many stories reached "${terminal}", and which are blocked or unresolved.`,
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
