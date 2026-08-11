import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspect } from "node:util";
import {
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { Agent } from "../model/agents/agent.model.ts";
import type { MessagePublisher } from "../model/messagePublisher.model.ts";

function timestamp(): string {
  return new Date().toISOString();
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result instanceof Error) return result.message;
  if (typeof result === "object" && result !== null) {
    const value = result as Record<string, unknown>;
    if (typeof value.text === "string") return value.text;
    if (Array.isArray(value.content)) {
      const content = value.content.map(resultText).join("\n");
      if (content) return content;
    }
  }
  return inspect(result, { depth: null, breakLength: Infinity });
}

export class AgentEventBridge {
  constructor(private readonly publisher: MessagePublisher) {}

  attach(
    agent: Agent,
    session: AgentSession,
    storyId?: number,
    iteration?: number,
  ): void {
    const scope = {
      runId: agent.runId,
      agent: agent.name,
      storyId,
      iteration,
    };

    this.publisher.publish({
      type: "agent_start",
      ...scope,
      timestamp: timestamp(),
    });

    session.subscribe((event: AgentSessionEvent) => {
      if (!(
        event.type === "message_update" &&
        event.assistantMessageEvent.type.includes("delta")
      )) {
        this.writeLog(event, agent, storyId, iteration);
      }

      switch (event.type) {
        case "agent_end":
          this.publisher.publish({
            type: "agent_end",
            ...scope,
            timestamp: timestamp(),
          });
          break;
        case "message_update":
          switch (event.assistantMessageEvent.type) {
            case "thinking_start":
              this.publisher.publish({
                type: "thinking_start",
                ...scope,
                timestamp: timestamp(),
              });
              break;
            case "thinking_end":
              this.publisher.publish({
                type: "thinking_end",
                ...scope,
                timestamp: timestamp(),
              });
              break;
            case "text_delta":
              this.publisher.publish({
                type: "text_delta",
                ...scope,
                delta: event.assistantMessageEvent.delta,
                timestamp: timestamp(),
              });
              break;
          }
          break;
        case "message_end":
          this.publisher.publish({
            type: "text_end",
            ...scope,
            timestamp: timestamp(),
          });
          break;
        case "tool_execution_start":
          this.publisher.publish({
            type: "tool_start",
            ...scope,
            tool: event.toolName,
            args: event.args as Record<string, unknown> | undefined,
            timestamp: timestamp(),
          });
          break;
        case "tool_execution_end":
          this.publisher.publish({
            type: "tool_end",
            ...scope,
            tool: event.toolName,
            isError: event.isError,
            result: event.isError ? resultText(event.result) : undefined,
            timestamp: timestamp(),
          });
          break;
      }
    });
  }

  private writeLog(
    event: object,
    agent: Agent,
    storyId?: number,
    iteration?: number,
  ): void {
    appendFileSync(
      resolve(agent.workspace.logDir, "outputlog.jsonl"),
      `${JSON.stringify({
        timestamp: new Date(),
        story: storyId,
        agentName: agent.name,
        iteration: iteration,
        ...event,
      })}\n`,
    );
  }
}
