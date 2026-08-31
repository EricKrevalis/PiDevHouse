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
  error?: string;
  failureDetail?: string;
}
