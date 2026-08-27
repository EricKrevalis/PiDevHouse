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
  agents: Record<string, AgentUsage>;
  stories: StorySummary[];
  error?: string;
  failureDetail?: string;
}
