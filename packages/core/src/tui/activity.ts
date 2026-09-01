import type { Message } from "../modules/models/message.model";

export type ToolStatus = "running" | "done" | "error";

export type ActivityEntry =
  | { type: "text"; text: string }
  | { type: "agent"; agent: string; storyId?: number; iteration?: number }
  | {
      type: "tool";
      toolCallId: string;
      tool: string;
      args?: Record<string, unknown>;
      status: ToolStatus;
      result?: string;
    };

export function reduceActivity(
  entries: ActivityEntry[],
  message: Message,
): ActivityEntry[] {
  switch (message.type) {
    case "text_delta": {
      const last = entries.at(-1);
      if (!last || last.type !== "text" || last.text === "") {
        return [...entries, { type: "text", text: message.delta }];
      }
      return [
        ...entries.slice(0, -1),
        { type: "text", text: last.text + message.delta },
      ];
    }
    case "text": {
      const text = message.text.trimEnd();
      const last = entries.at(-1);
      const next: ActivityEntry[] =
        last?.type === "text"
          ? [...entries.slice(0, -1), { type: "text", text }]
          : text
            ? [...entries, { type: "text", text }]
            : entries;
      const end = next.at(-1);
      return end?.type === "text" && end.text === ""
        ? next
        : [...next, { type: "text", text: "" }];
    }
    case "warning":
      return [
        ...entries,
        { type: "text", text: `warning · ${message.message}` },
      ];
    case "agent_start":
      return [
        ...entries,
        {
          type: "agent",
          agent: message.agent,
          storyId: message.storyId,
          iteration: message.iteration,
        },
        { type: "text", text: "" },
      ];
    case "agent_retry":
      return [
        ...entries,
        {
          type: "text",
          text: [
            "retry",
            message.agent,
            message.storyId === undefined
              ? undefined
              : `story ${message.storyId}`,
            message.iteration === undefined
              ? undefined
              : `iteration ${message.iteration}`,
            message.message,
          ]
            .filter((part): part is string => part !== undefined)
            .join(" · "),
        },
        { type: "text", text: "" },
      ];
    case "compaction_end": {
      const parts = [
        "compaction",
        message.agent,
        message.storyId === undefined ? undefined : `story ${message.storyId}`,
        message.reason,
        message.aborted ? "aborted" : undefined,
        message.willRetry ? "retrying" : undefined,
      ].filter((part): part is string => part !== undefined);
      return [...entries, { type: "text", text: parts.join(" · ") }, { type: "text", text: "" }];
    }
    case "tool_start":
      return [
        ...entries,
        {
          type: "tool",
          toolCallId: message.toolCallId,
          tool: message.tool,
          args: message.args,
          status: "running",
        },
      ];
    case "tool_end": {
      const index = entries.findLastIndex(
        (entry) =>
          entry.type === "tool" && entry.toolCallId === message.toolCallId,
      );
      const status: ToolStatus = message.isError ? "error" : "done";

      if (index === -1) {
        return [
          ...entries,
          {
            type: "tool",
            toolCallId: message.toolCallId,
            tool: message.tool,
            status,
            result: message.result,
          },
        ];
      }

      return entries.map((entry, entryIndex) =>
        entryIndex === index && entry.type === "tool"
          ? { ...entry, status, result: message.result }
          : entry,
      );
    }
    case "story_score":
      return [
        ...entries,
        {
          type: "text",
          text: `score story ${message.storyId} · ${message.variant}  ${message.score}`,
        },
      ];
    case "run_info":
      return [
        ...entries,
        { type: "text", text: `stories: ${message.totalStories}` },
      ];
    case "thinking":
    case "thinking_start":
    case "thinking_end":
    case "elapsed":
      return entries;
    default:
      return entries;
  }
}
