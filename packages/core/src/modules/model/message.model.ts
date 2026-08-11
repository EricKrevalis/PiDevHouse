export type RunStatus =
  | "running"
  | "retry"
  | "completed"
  | "incomplete"
  | "blocked"
  | "failed";

export type Message =
  | {
      type: "agent_start";
      runId: string;
      agent: string;
      storyId?: number;
      iteration?: number;
      timestamp: string;
    }
  | {
      type: "agent_end";
      runId: string;
      agent: string;
      storyId?: number;
      iteration?: number;
      timestamp: string;
    }
  | {
      type: "text_delta";
      runId: string;
      agent: string;
      delta: string;
      storyId?: number;
      iteration?: number;
      timestamp: string;
    }
  | {
      type: "text_end";
      runId: string;
      agent: string;
      storyId?: number;
      iteration?: number;
      timestamp: string;
    }
  | {
      type: "thinking_start";
      runId: string;
      agent: string;
      storyId?: number;
      iteration?: number;
      timestamp: string;
    }
  | {
      type: "thinking_end";
      runId: string;
      agent: string;
      storyId?: number;
      iteration?: number;
      timestamp: string;
    }
  | {
      type: "tool_start";
      runId: string;
      agent: string;
      tool: string;
      args?: Record<string, unknown>;
      storyId?: number;
      iteration?: number;
      timestamp: string;
    }
  | {
      type: "tool_end";
      runId: string;
      agent: string;
      tool: string;
      isError: boolean;
      result?: string;
      storyId?: number;
      iteration?: number;
      timestamp: string;
    }
  | {
      type: "story_score";
      runId: string;
      storyId: number;
      variant: "review" | "test";
      score: number;
      timestamp: string;
    }
  | {
      type: "story_blocked";
      runId: string;
      storyId: number;
      detail: string;
      timestamp: string;
    }
  | {
      type: "run_status";
      runId: string;
      status: RunStatus;
      attempt?: number;
      detail?: string;
      outputDir?: string;
      outcome?: string;
      error?: string;
      timestamp: string;
    }
  | {
      type: "run_info";
      runId: string;
      totalStories: number;
      timestamp: string;
    }
  | {
      type: "elapsed";
      runId: string;
      seconds: number;
      timestamp: string;
    };
