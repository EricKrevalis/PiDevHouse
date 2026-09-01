import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, it, vi } from "vitest";
import type { Agent } from "../../model/agents/agent.model.ts";
import type { Summary } from "../../model/summary.model.ts";
import { SummaryCollector } from "../summaryCollector.ts";

// controllable clock: attach() brackets each invocation with Date.now(), so
// setting the value before each emitted event gives deterministic durations.
let clock = 0;
vi.spyOn(Date, "now").mockImplementation(() => clock);

afterEach(() => {
  clock = 0;
});

// a fresh fake session whose subscribe() hands back the emit function, matching
// the one-session-per-invocation shape of agent.model.ts's run().
function fakeSession(): {
  session: AgentSession;
  emit: (event: AgentSessionEvent) => void;
} {
  let emit: (event: AgentSessionEvent) => void = () => {};
  const session = {
    subscribe(listener: (event: AgentSessionEvent) => void) {
      emit = listener;
      return () => {};
    },
  } as unknown as AgentSession;
  return {
    session,
    emit: (event) => emit(event),
  };
}

const agent = (name: string): Agent => ({ name }) as Agent;

async function collectAgents(
  collector: SummaryCollector,
): Promise<Summary["agents"]> {
  const runDir = await mkdtemp(join(tmpdir(), "pidev-summary-"));
  await collector.writeSummary(runDir, {
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    durationSeconds: 60,
    request: "req",
    outcome: "completed",
    failureMode: "none",
    exitCode: 0,
    model: "test",
    config: {},
    environment: {
      thinkingLevel: "low",
      contextWindow: 65_536,
      maxTokens: 16_384,
      ollamaHost: "http://localhost:11434",
    },
    stories: [],
  });
  const summary = JSON.parse(
    await readFile(join(runDir, "summary.json"), "utf8"),
  ) as Summary;
  return summary.agents;
}

it("records duration and one invocation for a full start->end cycle", async () => {
  const collector = new SummaryCollector();
  const { session, emit } = fakeSession();
  collector.attach(agent("developer"), session);

  clock = 1000;
  emit({ type: "agent_start" } as AgentSessionEvent);
  clock = 1250;
  emit({ type: "agent_end" } as AgentSessionEvent);

  const agents = await collectAgents(collector);
  assert.equal(agents.developer.totalDurationMs, 250);
  assert.equal(agents.developer.invocations, 1);
});

it("accumulates duration across two invocations of the same agent", async () => {
  const collector = new SummaryCollector();

  const first = fakeSession();
  collector.attach(agent("developer"), first.session);
  clock = 0;
  first.emit({ type: "agent_start" } as AgentSessionEvent);
  clock = 300;
  first.emit({ type: "agent_end" } as AgentSessionEvent);

  const second = fakeSession();
  collector.attach(agent("developer"), second.session);
  clock = 1000;
  second.emit({ type: "agent_start" } as AgentSessionEvent);
  clock = 1700;
  second.emit({ type: "agent_end" } as AgentSessionEvent);

  const agents = await collectAgents(collector);
  assert.equal(agents.developer.totalDurationMs, 1000);
  assert.equal(agents.developer.invocations, 2);
});

it("ignores an agent_end with no preceding agent_start", async () => {
  const collector = new SummaryCollector();
  const { session, emit } = fakeSession();
  collector.attach(agent("developer"), session);

  clock = 5000;
  emit({ type: "agent_end" } as AgentSessionEvent);

  const agents = await collectAgents(collector);
  // no start seen, so no agent row is created at all.
  assert.equal(agents.developer, undefined);
});

it("a second agent_end with no start in between is ignored, not double-counted", async () => {
  const collector = new SummaryCollector();
  const { session, emit } = fakeSession();
  collector.attach(agent("developer"), session);

  clock = 1000;
  emit({ type: "agent_start" } as AgentSessionEvent);
  clock = 1200;
  emit({ type: "agent_end" } as AgentSessionEvent);
  clock = 1500;
  emit({ type: "agent_end" } as AgentSessionEvent);

  const agents = await collectAgents(collector);
  assert.equal(agents.developer.totalDurationMs, 200);
  assert.equal(agents.developer.invocations, 1);
});

it("a second agent_start before agent_end discards the first invocation's timing", async () => {
  const collector = new SummaryCollector();
  const { session, emit } = fakeSession();
  collector.attach(agent("developer"), session);

  clock = 0;
  emit({ type: "agent_start" } as AgentSessionEvent);
  clock = 100;
  emit({ type: "agent_start" } as AgentSessionEvent);
  clock = 350;
  emit({ type: "agent_end" } as AgentSessionEvent);

  const agents = await collectAgents(collector);
  // only the later start is tracked, so the recorded duration is measured
  // from the second start, not the first.
  assert.equal(agents.developer.totalDurationMs, 250);
  assert.equal(agents.developer.invocations, 1);
});

// writes a summary carrying real stories, for the story-level assertions below.
async function collectSummary(
  collector: SummaryCollector,
  stories: Parameters<SummaryCollector["writeSummary"]>[1]["stories"] = [],
): Promise<Summary> {
  const runDir = await mkdtemp(join(tmpdir(), "pidev-summary-"));
  await collector.writeSummary(runDir, {
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    durationSeconds: 60,
    request: "req",
    outcome: "completed",
    failureMode: "none",
    exitCode: 0,
    model: "test",
    config: {},
    environment: {
      thinkingLevel: "low",
      contextWindow: 65_536,
      maxTokens: 16_384,
      ollamaHost: "http://localhost:11434",
    },
    stories,
  });
  return JSON.parse(
    await readFile(join(runDir, "summary.json"), "utf8"),
  ) as Summary;
}

const storyFixture = (
  id: number,
  blockedBy: number[] = [],
  criteria = 1,
): Parameters<SummaryCollector["writeSummary"]>[1]["stories"][number] => ({
  id,
  title: `story ${id}`,
  description: "d",
  acceptanceCriteria: Array.from({ length: criteria }, (_, i) => `c${i}`),
  blockedBy,
  status: "tested",
  reviewResult: { score: 100, note: "" },
  testResult: { score: 100, note: "" },
});

it("keeps a refused verdict write out of the trajectory", async () => {
  // update_story_fields rejects for a bad schema, a missing file, an unknown id
  // or a failed post-merge validation, all after the start event has fired.
  // recording on start put scores in the trajectory that never reached disk.
  const collector = new SummaryCollector();
  const { session, emit } = fakeSession();
  collector.attach(agent("reviewer"), session, 1, 1);

  emit({
    type: "tool_execution_start",
    toolCallId: "a",
    toolName: "update_story_fields",
    args: { id: 1, fields: { reviewResult: { score: 90 } } },
  } as unknown as AgentSessionEvent);
  emit({
    type: "tool_execution_end",
    toolCallId: "a",
    toolName: "update_story_fields",
    isError: true,
  } as unknown as AgentSessionEvent);

  emit({
    type: "tool_execution_start",
    toolCallId: "b",
    toolName: "update_story_fields",
    args: { id: 1, fields: { reviewResult: { score: 75 } } },
  } as unknown as AgentSessionEvent);
  emit({
    type: "tool_execution_end",
    toolCallId: "b",
    toolName: "update_story_fields",
    isError: false,
  } as unknown as AgentSessionEvent);

  const summary = await collectSummary(collector, [storyFixture(1)]);
  // only the write that landed
  assert.deepEqual(summary.stories[0].reviewTrajectory, [75]);
});

it("files a verdict under the story it names, not the story in flight", async () => {
  const collector = new SummaryCollector();
  const { session, emit } = fakeSession();
  collector.attach(agent("reviewer"), session, 1, 1);

  emit({
    type: "tool_execution_start",
    toolCallId: "a",
    toolName: "update_story_fields",
    args: { id: 2, fields: { reviewResult: { score: 60 } } },
  } as unknown as AgentSessionEvent);
  emit({
    type: "tool_execution_end",
    toolCallId: "a",
    toolName: "update_story_fields",
    isError: false,
  } as unknown as AgentSessionEvent);

  const summary = await collectSummary(collector, [
    storyFixture(1),
    storyFixture(2),
  ]);
  assert.deepEqual(summary.stories[0].reviewTrajectory, []);
  assert.deepEqual(summary.stories[1].reviewTrajectory, [60]);
});

it("keeps silent-gate counts on a story that recovered", async () => {
  // routing these through noteBlocked meant they survived only on stories that
  // failed, which is the one case where they explain the least.
  const collector = new SummaryCollector();
  collector.noteGateOutcome({ storyId: 1, gateRetries: 1, silentGates: 2 });

  const summary = await collectSummary(collector, [storyFixture(1)]);
  assert.equal(summary.stories[0].status, "tested");
  assert.equal(summary.stories[0].silentGates, 2);
  assert.equal(summary.stories[0].gateRetries, 1);
});

it("measures the plan's shape", async () => {
  const collector = new SummaryCollector();
  // 1 -> 2 -> 3 is a chain of depth 3; 4 stands alone.
  const summary = await collectSummary(collector, [
    storyFixture(1, [], 4),
    storyFixture(2, [1], 2),
    storyFixture(3, [2], 2),
    storyFixture(4, [], 0),
  ]);

  assert.equal(summary.plan?.storyCount, 4);
  assert.equal(summary.plan?.maxChainDepth, 3);
  assert.equal(summary.plan?.rootStories, 2);
  assert.equal(summary.plan?.criteriaPerStory, 2);
  assert.equal(summary.plan?.firstStoryCriteria, 4);
});
