import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Agent } from "../model/agents/agent.model.ts";
import type { Story } from "../model/story.model.ts";
import type { AgentUsage, Summary } from "../model/summary.model.ts";

let instance: SummaryCollector | undefined;

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
  static getInstance(): SummaryCollector {
    instance ??= new SummaryCollector();
    return instance;
  }

  private constructor() {}

  private readonly runs = new Map<string, RunState>();

  private state(runId: string): RunState {
    let run = this.runs.get(runId);
    if (run === undefined) {
      run = { agents: new Map(), tracks: new Map() };
      this.runs.set(runId, run);
    }
    return run;
  }

  run(agent: Agent, session: AgentSession, story?: number, iteration?: number): void {
    session.subscribe((event) => this.record(event, agent, story, iteration));
  }

  private record(
    event: AgentSessionEvent,
    agent: Agent,
    story: number | undefined,
    iteration: number | undefined,
  ): void {
    const state = this.state(agent.runId);
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

    if (story === undefined) return;
    const track = state.tracks.get(story) ?? {
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
    state.tracks.set(story, track);
  }

  async writeSummary(runId: string, runDir: string, metadata: RunMetadata): Promise<void> {
    const state = this.state(runId);
    const { stories, ...run } = metadata;
    const summary: Summary = { ...run, ...this.collect(state, stories) };
    await writeFile(
      resolve(runDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    this.runs.delete(runId);
  }

  private collect(state: RunState, stories: Story[]): Pick<Summary, "agents" | "stories" | "guide"> {
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
