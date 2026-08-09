import type { StoryStatus } from "./story.model.ts";

export type OutcomeClass = "completed" | "incomplete" | "timeout" | "error";

export interface AgentUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface StorySummary {
  id: number;
  title: string;
  status: StoryStatus;
  reviewScore: number;
  testScore: number;
  iterations: number;
  reviewTrajectory: number[];
  testTrajectory: number[];
}

export interface Summary {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  request: string;
  outcome: OutcomeClass;
  model: string;
  config: Record<string, string | number | boolean>;
  agents: Record<string, AgentUsage>;
  stories: StorySummary[];
  guide?: string;
  error?: string;
}
