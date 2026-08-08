import {
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { broadcast } from "../../api/server.ts";
import { Agent } from "../model/agents/agent.model.ts";

const textEncoder = new TextEncoder();
let instance: AgentEventService | undefined;

export class AgentEventService {
  static getInstance(): AgentEventService {
    instance ??= new AgentEventService();
    return instance;
  }

  private constructor(private readonly isApi = false) {}

  private writeOutput(message: string): void {
    Deno.stdout.writeSync(textEncoder.encode(message));
  }

  private formatToolDetails(toolName: string, args: unknown): string {
    if (!args || typeof args !== "object") return "";

    const values = args as Record<string, unknown>;
    if (toolName === "bash" && typeof values.command === "string") {
      const command =
        values.command.slice(0, 500) +
        (values.command.length > 500 ? "..." : "");
      return `\n  $ ${command}`;
    }

    const path = values.path ?? values.file_path;
    return path ? `\n  path: ${path}` : "";
  }

  run(agent: Agent, session: AgentSession, story?: number, iteration?: number) {
    const context = [
      story && `story ${story}`,
      iteration && `iter ${iteration}`,
    ]
      .filter(Boolean)
      .join(" · ");

    const label = context ? `${context} · ${agent.name}` : agent.name;
    const thinking = new ThinkingAnimation((c) => this.emit(c), label);

    this.emit(`${label}: starting...\n`);
    let isStreamBeginning = true;

    session.subscribe((event: AgentSessionEvent) => {
      if (!(
        event.type === "message_update" &&
        event.assistantMessageEvent.type.includes("delta")
      )) {
        this.writeLog(event, agent, story, iteration);
      }

      const updateType = event.assistantMessageEvent?.type;
      switch (event.type) {
        case "message_update":
          if (updateType == "thinking_start") {
            thinking.start();
          } else if (updateType == "thinking_end") {
            thinking.stop();
          } else if (updateType == "text_delta") {
            thinking.stop();
            if (isStreamBeginning) {
              this.emit(`${label}:\n`);
              isStreamBeginning = false;
            }
            this.emit(event.assistantMessageEvent.delta);
          }
          break;
        case "message_end":
          thinking.stop();
          if (!isStreamBeginning) {
            isStreamBeginning = true;
          }
          break;
        case "tool_execution_start":
          thinking.stop();
          this.emit(
            `${label}: ${event.toolName}${this.formatToolDetails(event.toolName, event.args)}\n`,
          );
          break;
        case "tool_execution_end":
          if (event.isError) {
            this.emit(
              `Error executing tool ${event.toolName}: ${event.result.text}\n`,
            );
          }
          break;
      }
    });
  }

  emit(content: string) {
    if (!this.isApi) {
      this.writeOutput(content);
    }
    broadcast(content.replace(/\r(\x1b\[K)?/g, ""));
  }

  private writeLog(
    event: object,
    agent: Agent,
    story?: number,
    iteration?: number,
  ) {
    Deno.writeTextFile(
      resolve(agent.workspace.logDir, "outputlog.jsonl"),
      `${JSON.stringify({
        timestamp: new Date(),
        story: story,
        agentName: agent.name,
        iteration: iteration,
        ...event,
      })}\n`,
      { append: true },
    );
  }
}

class ThinkingAnimation {
  private timer: ReturnType<typeof setInterval> | undefined;
  private index = 0;
  private readonly frames = [
    "thinking",
    "thinking.",
    "thinking..",
    "thinking...",
  ];

  constructor(
    private readonly emit: (content: string) => void,
    private readonly label: string,
  ) {}

  start(): void {
    this.stop();
    this.index = 0;
    this.emit(`\r${this.label}: ${this.frames[0]}`);
    this.timer = setInterval(() => {
      this.index = (this.index + 1) % this.frames.length;
      this.emit(`\r\x1b[K${this.label}: ${this.frames[this.index]}`);
    }, 300);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.emit("\r\x1b[K");
  }
}
