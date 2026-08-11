import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { Agent } from "../model/agents/agent.model.ts";
import type { Story } from "../model/story.model.ts";
import type { AgentUsage, Summary } from "../model/summary.model.ts";

interface StoryTrack {
  iterations: number;
  reviewTrajectory: number[];
  testTrajectory: number[];
}

interface RunState {
  agents: Map<string, AgentUsage>;
  tracks: Map<number, StoryTrack>;
  guide?: string;
}

type RunMetadata = Omit<Summary, "agents" | "stories" | "guide"> & {
  stories: Story[];
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type?: string; text?: unknown }>)
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

export class SummaryCollector {
  private readonly state: RunState = { agents: new Map(), tracks: new Map() };

  attach(
    agent: Agent,
    session: AgentSession,
    storyId?: number,
    iteration?: number,
  ): void {
    session.subscribe((event) => this.record(event, agent, storyId, iteration));
  }

  private record(
    event: AgentSessionEvent,
    agent: Agent,
    storyId: number | undefined,
    iteration: number | undefined,
  ): void {
    const state = this.state;
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = state.agents.get(agent.name) ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      };
      usage.calls += 1;
      usage.inputTokens += event.message.usage.input;
      usage.outputTokens += event.message.usage.output;
      usage.reasoningTokens += event.message.usage.reasoning ?? 0;
      state.agents.set(agent.name, usage);

      if (agent.name === "guide") {
        const text = messageText(event.message.content);
        if (text !== "") state.guide = text;
      }
    }

    if (storyId === undefined) return;
    const track = state.tracks.get(storyId) ?? {
      iterations: 0,
      reviewTrajectory: [],
      testTrajectory: [],
    };
    if (typeof iteration === "number") {
      track.iterations = Math.max(track.iterations, iteration);
    }
    if (
      event.type === "tool_execution_start" &&
      event.toolName === "update_story_fields"
    ) {
      const fields = event.args?.fields;
      if (typeof fields?.reviewResult?.score === "number") {
        track.reviewTrajectory.push(fields.reviewResult.score);
      }
      if (typeof fields?.testResult?.score === "number") {
        track.testTrajectory.push(fields.testResult.score);
      }
    }
    state.tracks.set(storyId, track);
  }

  async writeSummary(runDir: string, metadata: RunMetadata): Promise<void> {
    const { stories, ...run } = metadata;
    const summary: Summary = { ...run, ...this.collect(this.state, stories) };
    await writeFile(
      resolve(runDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }

  private collect(
    state: RunState,
    stories: Story[],
  ): Pick<Summary, "agents" | "stories" | "guide"> {
    return {
      agents: Object.fromEntries(state.agents),
      stories: stories.map((story) => ({
        id: story.id,
        title: story.title,
        status: story.status,
        reviewScore: story.reviewResult.score,
        testScore: story.testResult.score,
        ...(state.tracks.get(story.id) ?? {
          iterations: 0,
          reviewTrajectory: [],
          testTrajectory: [],
        }),
      })),
      guide: state.guide,
    };
  }
}
