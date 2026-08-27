import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../models/message.model.ts";
import type { MessageBus } from "./messageBus.ts";

export interface AgentScope {
  agent: string;
  storyId?: number;
  iteration?: number;
}

export class AgentEventBridge {
  constructor(private readonly bus: MessageBus) {}

  retry(scope: AgentScope, message: string): void {
    this.bus.publish({
      ...scope,
      type: "agent_retry",
      message,
      timestamp: new Date().toISOString(),
    });
  }

  attach(session: AgentSession, scope: AgentScope): void {
    let pendingDelta = "";
    let hasPendingDelta = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = (event: AgentEvent) =>
      this.bus.publish({
        ...scope,
        timestamp: new Date().toISOString(),
        ...event,
      });
    // Coalesce streaming deltas: one log line per ~100ms instead of per token.
    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (!hasPendingDelta) return;
      publish({ type: "text_delta", delta: pendingDelta });
      pendingDelta = "";
      hasPendingDelta = false;
    };

    publish({ type: "agent_start" });

    session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "agent_end":
          flush();
          publish({ type: "agent_end" });
          break;
        case "message_end":
          if (event.message.role === "assistant") {
            flush();
            publish({ type: "text_end" });
          }
          break;
        case "message_update":
          switch (event.assistantMessageEvent.type) {
            case "thinking_start":
              flush();
              publish({ type: "thinking_start" });
              break;
            case "thinking_end":
              flush();
              publish({ type: "thinking_end" });
              break;
            case "text_delta":
              pendingDelta += event.assistantMessageEvent.delta;
              hasPendingDelta = true;
              flushTimer ??= setTimeout(flush, 100);
              break;
          }
          break;
        case "tool_execution_start":
          flush();
          publish({
            type: "tool_start",
            toolCallId: event.toolCallId,
            tool: event.toolName,
            args: event.args as Record<string, unknown> | undefined,
          });
          break;
        case "tool_execution_end":
          flush();
          publish({
            type: "tool_end",
            toolCallId: event.toolCallId,
            tool: event.toolName,
            isError: event.isError,
            result: event.isError ? resultText(event.result) : undefined,
          });
          break;
      }
    });
  }
}

function resultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return String(result ?? "");

  if ("content" in result && Array.isArray(result.content)) {
    const text = result.content
      .filter(
        (item): item is { type: "text"; text: string } =>
          typeof item === "object" &&
          item !== null &&
          item.type === "text" &&
          typeof item.text === "string",
      )
      .map((item) => item.text)
      .join("\n");
    if (text) return text;
  }

  return JSON.stringify(result);
}
