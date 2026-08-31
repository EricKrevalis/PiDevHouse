import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { Agent } from "../models/agent.model.ts";
import type { Story, StoryStatus } from "../models/story.model.ts";

export interface AgentUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Average generation throughput: output tokens per second of streaming. */
  tokensPerSecond: number;
  toolCalls: number;
  compactions: number;
  /** Per model call: token usage and time to first token in seconds. */
  callLog: { input: number; output: number; ttftSeconds: number | null }[];
}

export type OutcomeClass =
  | "completed"
  | "incomplete"
  | "infrastructure"
  | "no_ready"
  | "max_iterations"
  | "timeout"
  | "cancelled"
  | "error";

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}

export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "Error", message: String(error) };
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause === undefined ? undefined : serializeError(error.cause),
  };
}

export interface Summary {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  /** Duration formatted as H:MM:SS. */
  durationHms: string;
  request: string;
  outcome: OutcomeClass;
  error?: SerializedError;
  agents: Record<string, AgentUsage>;
  stories: {
    id: number;
    title: string;
    status: StoryStatus;
    iterations: number;
    reviewScore: number | undefined;
    testScore: number | undefined;
  }[];
}

export function formatDurationHms(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export class SummaryCollector {
  private readonly agents = new Map<string, AgentUsage>();
  private readonly iterations = new Map<number, number>();
  private readonly reasoningChars = new Map<string, number>();
  private readonly generationStart = new Map<string, number>();
  private readonly firstTokenAt = new Map<string, number>();
  private readonly generationMs = new Map<string, number>();

  attach(
    agent: Agent,
    session: AgentSession,
    storyId?: number,
    iteration?: number,
  ): void {
    session.subscribe((event) =>
      this.record(event, agent.name, storyId, iteration),
    );
  }

  private record(
    event: AgentSessionEvent,
    agentName: string,
    storyId: number | undefined,
    iteration: number | undefined,
  ): void {
    if (event.type === "compaction_end") {
      this.usageFor(agentName).compactions += 1;
      return;
    }
    if (event.type === "tool_execution_start") {
      this.usageFor(agentName).toolCalls += 1;
      return;
    }
    if (
      event.type === "message_start" &&
      event.message.role === "assistant"
    ) {
      this.generationStart.set(agentName, performance.now());
      this.firstTokenAt.delete(agentName);
      return;
    }
    if (event.type === "message_update") {
      const kind = event.assistantMessageEvent.type;
      if (kind === "thinking_delta") {
        this.firstTokenAt.set(agentName, performance.now());
        this.reasoningChars.set(
          agentName,
          (this.reasoningChars.get(agentName) ?? 0) +
            event.assistantMessageEvent.delta.length,
        );
        return;
      }
      if (kind === "text_delta") {
        this.firstTokenAt.set(agentName, performance.now());
      }
      return;
    }
    if (event.type !== "message_end" || event.message.role !== "assistant") {
      return;
    }
    const usage = this.usageFor(agentName);
    usage.calls += 1;
    const input = event.message.usage?.input ?? 0;
    const output = event.message.usage?.output ?? 0;
    usage.inputTokens += input;
    usage.outputTokens += output;
    usage.reasoningTokens +=
      event.message.usage?.reasoning ??
      Math.ceil((this.reasoningChars.get(agentName) ?? 0) / 4);
    this.reasoningChars.set(agentName, 0);
    const startedAt = this.generationStart.get(agentName);
    const firstTokenAt = this.firstTokenAt.get(agentName);
    usage.callLog.push({
      input,
      output,
      ttftSeconds:
        startedAt !== undefined && firstTokenAt !== undefined
          ? (firstTokenAt - startedAt) / 1000
          : null,
    });
    if (startedAt !== undefined) {
      this.generationStart.delete(agentName);
      const generationMs =
        (this.generationMs.get(agentName) ?? 0) + performance.now() - startedAt;
      this.generationMs.set(agentName, generationMs);
      usage.tokensPerSecond = (usage.outputTokens / generationMs) * 1000;
    }
    this.agents.set(agentName, usage);

    if (storyId !== undefined && typeof iteration === "number") {
      this.iterations.set(
        storyId,
        Math.max(this.iterations.get(storyId) ?? 0, iteration),
      );
    }
  }

  private usageFor(agentName: string): AgentUsage {
    const usage = this.agents.get(agentName) ?? {
      callLog: [],
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      tokensPerSecond: 0,
      toolCalls: 0,
      compactions: 0,
      calls: 0,
    };
    this.agents.set(agentName, usage);
    return usage;
  }

  async writeSummary(
    runDir: string,
    metadata: Omit<Summary, "agents" | "stories" | "durationHms"> & { stories: Story[] },
  ): Promise<void> {
    const summary: Summary = {
      ...metadata,
      durationHms: formatDurationHms(metadata.durationSeconds),
      agents: Object.fromEntries(this.agents),
      stories: metadata.stories.map((story) => ({
        id: story.id,
        title: story.title,
        status: story.status,
        iterations: this.iterations.get(story.id) ?? 0,
        reviewScore: story.reviewResult.score,
        testScore: story.testResult.score,
      })),
    };
    await writeFile(
      resolve(runDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }
}
