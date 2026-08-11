import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { Agent } from "../model/agents/agent.model.ts";
import { Message } from "../model/message.model.ts";
import { EventBus } from "./eventBus.service.ts";

let instance: AgentEventBridge | undefined;

function timestamp(): string {
  return new Date().toISOString();
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (typeof result === "object" && result !== null && "text" in result) {
    const text = (result as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return String(result);
}

export class AgentEventBridge {
  static getInstance(): AgentEventBridge {
    instance ??= new AgentEventBridge();
    return instance;
  }

  private constructor() {}

  run(agent: Agent, session: AgentSession, story?: number, iteration?: number): void {
    const publish = (message: Message) => EventBus.getInstance().publish(message);
    const scope = {
      runId: agent.runId,
      agent: agent.name,
      storyId: story,
      iteration,
    };

    publish({
      type: "agent_start",
      ...scope,
      timestamp: timestamp(),
    });

    session.subscribe((event: AgentSessionEvent) => {
      if (!(
        event.type === "message_update" &&
        event.assistantMessageEvent.type.includes("delta")
      )) {
        this.writeLog(event, agent, story, iteration);
      }

      switch (event.type) {
        case "agent_end":
          publish({ type: "agent_end", ...scope, timestamp: timestamp() });
          break;
        case "message_update":
          switch (event.assistantMessageEvent.type) {
            case "thinking_start":
              publish({ type: "thinking_start", ...scope, timestamp: timestamp() });
              break;
            case "thinking_end":
              publish({ type: "thinking_end", ...scope, timestamp: timestamp() });
              break;
            case "text_delta":
              publish({
                type: "text_delta",
                ...scope,
                delta: event.assistantMessageEvent.delta,
                timestamp: timestamp(),
              });
              break;
          }
          break;
        case "message_end":
          publish({ type: "text_end", ...scope, timestamp: timestamp() });
          break;
        case "tool_execution_start":
          publish({
            type: "tool_start",
            ...scope,
            tool: event.toolName,
            args: event.args as Record<string, unknown> | undefined,
            timestamp: timestamp(),
          });
          break;
        case "tool_execution_end":
          publish({
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
    story?: number,
    iteration?: number,
  ): void {
    appendFileSync(
      resolve(agent.workspace.logDir, "outputlog.jsonl"),
      `${JSON.stringify({
        timestamp: new Date(),
        story: story,
        agentName: agent.name,
        iteration: iteration,
        ...event,
      })}\n`,
    );
  }
}
