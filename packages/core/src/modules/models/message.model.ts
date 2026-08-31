type AgentMessage = {
  agent: string;
  storyId?: number;
  iteration?: number;
  timestamp: string;
};

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "agent_retry"; message: string }
  | { type: "text_delta"; delta: string }
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "thinking_start" }
  | { type: "thinking_end" }
  | {
      type: "compaction_end";
      reason: "manual" | "threshold" | "overflow";
      aborted: boolean;
      willRetry: boolean;
    }
  | {
      type: "tool_start";
      toolCallId: string;
      tool: string;
      args?: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      tool: string;
      isError: boolean;
      result?: string;
    };

export type Message =
  | (AgentMessage & AgentEvent)
  | {
      type: "story_score";
      storyId: number;
      variant: "review" | "test";
      score: number;
      timestamp: string;
    }
  | {
      type: "run_info";
      totalStories: number;
      timestamp: string;
    }
  | { type: "warning"; message: string; timestamp: string }
  | {
      type: "elapsed";
      seconds: number;
      timestamp: string;
    };
