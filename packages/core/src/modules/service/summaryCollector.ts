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
  blockedReasons: Map<number, string>;
}

type RunMetadata = Omit<Summary, "agents" | "stories"> & {
  stories: Story[];
};

export class SummaryCollector {
  private readonly state: RunState = {
    agents: new Map(),
    tracks: new Map(),
    blockedReasons: new Map(),
  };

  noteBlocked(params: { storyId: number; reason: string }): void {
    this.state.blockedReasons.set(params.storyId, params.reason);
  }

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
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "thinking_delta"
    ) {
      const usage = state.agents.get(agent.name) ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      };
      usage.reasoningTokens += Math.ceil(event.assistantMessageEvent.delta.length / 4);
      state.agents.set(agent.name, usage);
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
    const summary: Summary = {
      ...run,
      ...this.collect(this.state, stories, metadata.config),
    };
    await writeFile(
      resolve(runDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }

  private collect(
    state: RunState,
    stories: Story[],
    config: RunMetadata["config"],
  ): Pick<Summary, "agents" | "stories"> {
    const reviewerEnabled = config.reviewerEnabled !== false;
    const testerEnabled = config.testerEnabled !== false;
    const agents = Object.fromEntries(state.agents);
    if (!reviewerEnabled) delete agents.reviewer;
    if (!testerEnabled) delete agents.tester;
    return {
      agents,
      stories: stories.map((story) => {
        const track = state.tracks.get(story.id) ?? {
          iterations: 0,
          reviewTrajectory: [],
          testTrajectory: [],
        };
        const blockedReason = state.blockedReasons.get(story.id);
        return {
          id: story.id,
          title: story.title,
          status: story.status,
          iterations: track.iterations,
          ...(blockedReason ? { blockedReason } : {}),
          ...(reviewerEnabled
            ? {
                reviewScore: story.reviewResult.score,
                reviewTrajectory: track.reviewTrajectory,
              }
            : {}),
          ...(testerEnabled
            ? {
                testScore: story.testResult.score,
                testTrajectory: track.testTrajectory,
              }
            : {}),
        };
      }),
    };
  }
}
