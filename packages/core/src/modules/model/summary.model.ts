import type { StoryStatus } from "./story.model.ts";

export type OutcomeClass =
  "completed" | "incomplete" | "timeout" | "error" | "cancelled";

export type FailureMode =
  | "none"
  | "planning"
  | "dependency"
  | "recovery"
  | "timeout"
  | "execution"
  | "cancelled";

export interface AgentUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  // wall-clock ms summed across every agent_start->agent_end pair for this
  // agent role in the run, and the count of those completed pairs.
  totalDurationMs: number;
  invocations: number;
  // invocations that ran out the run's time budget rather than ending on their
  // own. a gate agent that times out records no verdict, which burns an
  // iteration silently, so this separates that from a model that simply failed.
  timedOutInvocations: number;
  longestInvocationMs: number;
  // longest single tool call, the signal for a hung command holding the budget.
  longestToolCallMs: number;
  // tool calls the scope guard refused before they ran: out of scope, wrong
  // write target, or over the per-invocation budget. scope refusals only: a
  // command the bash denylist refuses is rewritten to a failing echo and still
  // runs as a tool call, so it lands in sandboxDenials instead.
  rejectedToolCalls: number;
  // tool calls that passed the guard and ran. the denominator for any
  // per-tool-call rate: `calls` counts assistant turns, not tool calls.
  executedToolCalls: number;
  // commands the bash denylist refused. these succeed as tool calls while doing
  // no work, which hides them from rejectedToolCalls despite being the larger
  // waste channel (223 in a single run before the sandbox prompt section).
  sandboxDenials: number;
}

export interface StorySummary {
  id: number;
  title: string;
  status: StoryStatus;
  iterations: number;
  reviewScore?: number;
  testScore?: number;
  reviewTrajectory?: number[];
  testTrajectory?: number[];
  blockedReason?: string;
  // gate runs that ended without writing a verdict for this story.
  silentGates?: number;
  // gate reruns spent recovering a silent gate, before falling back to another
  // developer iteration.
  gateRetries?: number;
  // never attempted: a story this one depends on blocked first. without this a
  // run that skipped half its stories reads the same as one that tried them all.
  skippedByDependency?: boolean;
}

// what the product owner produced, measured. planning is the stage every later
// stage inherits its cost from, and it was the only one leaving no trace beyond
// the stories themselves: a run could not say whether it failed because the
// model could not build the thing or because the plan front-loaded every risk
// into story 1.
export interface PlanShape {
  storyCount: number;
  // longest chain of blockedBy edges. 1 means fully independent stories, n
  // means a linked list where one blocked story strands everything after it.
  maxChainDepth: number;
  // stories nothing blocks, so the first scheduling pass can start them. more
  // than one is the only way the runner ever has a choice.
  rootStories: number;
  criteriaPerStory: number;
  // criteria on the story scheduled first, the usual place a run dies.
  firstStoryCriteria: number;
}

// the independent variables of a run. without these the artifact cannot say
// which configuration produced it, and runs are only comparable by directory name.
export interface RunEnvironment {
  thinkingLevel: string;
  contextWindow: number;
  maxTokens: number;
  ollamaHost: string;
  commit?: string;
}

export interface Summary {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  request: string;
  outcome: OutcomeClass;
  failureMode: FailureMode;
  exitCode: number;
  model: string;
  config: Record<string, string | number | boolean>;
  environment: RunEnvironment;
  agents: Record<string, AgentUsage>;
  stories: StorySummary[];
  // absent when the product owner never produced a valid plan.
  plan?: PlanShape;
  error?: string;
  failureDetail?: string;
}
