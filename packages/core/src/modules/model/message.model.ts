export type RunStatus =
  | "running"
  | "retry"
  | "completed"
  | "incomplete"
  | "blocked"
  | "failed"
  | "cancelled";

type AgentMessage = {
  runId: string;
  agent: string;
  storyId?: number;
  iteration?: number;
  timestamp: string;
};

export type Message =
  | (AgentMessage & { type: "agent_start" })
  | (AgentMessage & { type: "agent_end" })
  | (AgentMessage & { type: "text_delta"; delta: string })
  | (AgentMessage & { type: "text_end" })
  | (AgentMessage & { type: "thinking_start" })
  | (AgentMessage & { type: "thinking_end" })
  | (AgentMessage & {
      type: "tool_start";
      tool: string;
      args?: Record<string, unknown>;
    })
  | (AgentMessage & {
      type: "tool_end";
      tool: string;
      isError: boolean;
      result?: string;
    })
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
