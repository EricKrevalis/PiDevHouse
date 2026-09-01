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

// a verdict write in flight: its args, held from the start event until the end
// event says whether it landed.
interface PendingVerdict {
  storyId: number;
  reviewScore?: number;
  testScore?: number;
}

interface RunState {
  agents: Map<string, AgentUsage>;
  tracks: Map<number, StoryTrack>;
  blockedReasons: Map<number, string>;
  silentGates: Map<number, number>;
  gateRetries: Map<number, number>;
  skipped: Set<number>;
  pendingVerdicts: Map<string, PendingVerdict>;
}

type RunMetadata = Omit<Summary, "agents" | "stories"> & {
  stories: Story[];
};

function freshUsage(): AgentUsage {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalDurationMs: 0,
    invocations: 0,
    timedOutInvocations: 0,
    longestInvocationMs: 0,
    longestToolCallMs: 0,
    rejectedToolCalls: 0,
    executedToolCalls: 0,
    sandboxDenials: 0,
  };
}

export class SummaryCollector {
  private readonly state: RunState = {
    agents: new Map(),
    tracks: new Map(),
    blockedReasons: new Map(),
    silentGates: new Map(),
    gateRetries: new Map(),
    skipped: new Set(),
    pendingVerdicts: new Map(),
  };

  // silentGates and gateRetries do not come through here: they are recorded by
  // noteGateOutcome from the story runner's finally, so they survive on stories
  // that recovered and on runs that aborted.
  noteBlocked(params: { storyId: number; reason: string }): void {
    this.state.blockedReasons.set(params.storyId, params.reason);
  }

  // written from the story runner's finally, so a story that hit silent gates
  // and then recovered keeps the evidence. routing these only through
  // noteBlocked meant they survived only on stories that failed, which is the
  // one case where they explain the least.
  noteGateOutcome(params: {
    storyId: number;
    gateRetries: number;
    silentGates: number;
  }): void {
    if (params.gateRetries > 0) {
      this.state.gateRetries.set(params.storyId, params.gateRetries);
    }
    if (params.silentGates > 0) {
      this.state.silentGates.set(params.storyId, params.silentGates);
    }
  }

  // a story the workflow never reached: a dependency blocked, or the run ended
  // before its turn came up.
  noteSkippedByDependency(storyId: number): void {
    this.state.skipped.add(storyId);
  }

  noteToolCallBudget(
    agentName: string,
    budget: { executed: number; rejected: number; sandboxDenials?: number },
  ): void {
    const usage = this.state.agents.get(agentName) ?? freshUsage();
    usage.rejectedToolCalls += budget.rejected;
    usage.executedToolCalls += budget.executed;
    usage.sandboxDenials += budget.sandboxDenials ?? 0;
    this.state.agents.set(agentName, usage);
  }

  attach(
    agent: Agent,
    session: AgentSession,
    storyId?: number,
    iteration?: number,
  ): void {
    // start time for THIS invocation, local to this attach() call. the raw
    // session events carry no timestamp, so we bracket with wall-clock.
    let invocationStartedAt: number | undefined;
    const toolStartedAt = new Map<string, number>();
    session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        toolStartedAt.set(event.toolCallId, Date.now());
      } else if (event.type === "tool_execution_end") {
        const startedAt = toolStartedAt.get(event.toolCallId);
        if (startedAt !== undefined) {
          toolStartedAt.delete(event.toolCallId);
          this.recordToolDuration(agent.name, Date.now() - startedAt);
        }
      }
      if (event.type === "agent_start") {
        invocationStartedAt = Date.now();
      } else if (event.type === "agent_end") {
        // skip an unmatched agent_end rather than guess a duration.
        if (invocationStartedAt !== undefined) {
          this.recordDuration(
            agent.name,
            Date.now() - invocationStartedAt,
            agent.timeoutMinutes,
          );
          invocationStartedAt = undefined;
        }
      }
      this.record(event, agent, storyId, iteration);
    });
  }

  private recordToolDuration(agentName: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const usage = this.state.agents.get(agentName) ?? freshUsage();
    usage.longestToolCallMs = Math.max(usage.longestToolCallMs, durationMs);
    this.state.agents.set(agentName, usage);
  }

  private recordDuration(
    agentName: string,
    durationMs: number,
    timeoutMinutes = 0,
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const usage = this.state.agents.get(agentName) ?? freshUsage();
    usage.totalDurationMs += durationMs;
    usage.invocations += 1;
    usage.longestInvocationMs = Math.max(usage.longestInvocationMs, durationMs);
    // the timer fires at the budget, so an invocation that reaches it was cut
    // off rather than finished. allow a small margin for the teardown after it.
    if (timeoutMinutes > 0 && durationMs >= timeoutMinutes * 60_000) {
      usage.timedOutInvocations += 1;
    }
    this.state.agents.set(agentName, usage);
  }

  private record(
    event: AgentSessionEvent,
    agent: Agent,
    storyId: number | undefined,
    iteration: number | undefined,
  ): void {
    const state = this.state;
    if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = state.agents.get(agent.name) ?? freshUsage();
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
      const usage = state.agents.get(agent.name) ?? freshUsage();
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
    // the args live on the start event and the outcome on the end event, so a
    // verdict is held here until its call returns. only the start event was
    // read before, which recorded scores that never reached disk:
    // update_story_fields still rejects for a bad schema, a missing
    // stories.json, an unknown id, or a failed post-merge validation, all after
    // the start event has fired. a trajectory has to be the story's persisted
    // history, not what an agent tried to write.
    if (
      event.type === "tool_execution_start" &&
      event.toolName === "update_story_fields"
    ) {
      const target = event.args?.id;
      state.pendingVerdicts.set(event.toolCallId, {
        // the id the call names, not the story the agent was launched for: a
        // verdict written to another story belongs to that story's trajectory.
        storyId: typeof target === "number" ? target : storyId,
        reviewScore: event.args?.fields?.reviewResult?.score,
        testScore: event.args?.fields?.testResult?.score,
      });
    }
    if (event.type === "tool_execution_end") {
      const pending = state.pendingVerdicts.get(event.toolCallId);
      if (pending !== undefined) {
        state.pendingVerdicts.delete(event.toolCallId);
        if (event.isError !== true) {
          const targetTrack =
            pending.storyId === storyId
              ? track
              : (state.tracks.get(pending.storyId) ?? {
                  iterations: 0,
                  reviewTrajectory: [],
                  testTrajectory: [],
                });
          if (typeof pending.reviewScore === "number") {
            targetTrack.reviewTrajectory.push(pending.reviewScore);
          }
          if (typeof pending.testScore === "number") {
            targetTrack.testTrajectory.push(pending.testScore);
          }
          if (pending.storyId !== storyId) {
            state.tracks.set(pending.storyId, targetTrack);
          }
        }
      }
    }
    state.tracks.set(storyId, track);
  }

  // the plan's structure, derived from the stories at teardown. computed here
  // rather than at planning time so it also covers runs that died later.
  private planShape(stories: Story[]): Summary["plan"] {
    if (stories.length === 0) return undefined;
    const blockers = new Map(stories.map((s) => [s.id, s.blockedBy]));
    const depths = new Map<number, number>();
    const depth = (id: number, seen: Set<number>): number => {
      const cached = depths.get(id);
      if (cached !== undefined) return cached;
      // a cycle should be impossible past the schema, but this runs on
      // historical files too, so it must not recurse forever.
      if (seen.has(id)) return 0;
      seen.add(id);
      const parents = blockers.get(id) ?? [];
      const value =
        parents.length === 0
          ? 1
          : 1 + Math.max(...parents.map((parent) => depth(parent, seen)));
      seen.delete(id);
      depths.set(id, value);
      return value;
    };
    const criteria = stories.map((s) => s.acceptanceCriteria.length);
    const first = stories.find((s) => s.blockedBy.length === 0) ?? stories[0];
    return {
      storyCount: stories.length,
      maxChainDepth: Math.max(...stories.map((s) => depth(s.id, new Set()))),
      rootStories: stories.filter((s) => s.blockedBy.length === 0).length,
      criteriaPerStory:
        criteria.reduce((sum, n) => sum + n, 0) / stories.length,
      firstStoryCriteria: first.acceptanceCriteria.length,
    };
  }

  async writeSummary(runDir: string, metadata: RunMetadata): Promise<void> {
    const { stories, ...run } = metadata;
    const plan = this.planShape(stories);
    const summary: Summary = {
      ...run,
      ...this.collect(this.state, stories, metadata.config),
      ...(plan ? { plan } : {}),
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
        const silentGates = state.silentGates.get(story.id);
        const gateRetries = state.gateRetries.get(story.id);
        return {
          id: story.id,
          title: story.title,
          status: story.status,
          iterations: track.iterations,
          ...(blockedReason ? { blockedReason } : {}),
          ...(silentGates !== undefined ? { silentGates } : {}),
          ...(gateRetries !== undefined ? { gateRetries } : {}),
          ...(state.skipped.has(story.id)
            ? { skippedByDependency: true }
            : {}),
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
