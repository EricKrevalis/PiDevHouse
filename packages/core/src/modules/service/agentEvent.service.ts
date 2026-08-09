import {
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { broadcast } from "../../api/server.ts";
import { Agent } from "../model/agents/agent.model.ts";

const textEncoder = new TextEncoder();
const COLOR = "\x1b[36m";
const RESET = "\x1b[0m";
let instance: AgentEventService | undefined;

function writeOutput(message: string): void {
  Deno.stdout.writeSync(textEncoder.encode(message));
}

export class AgentEventService {
  static getInstance(): AgentEventService {
    instance ??= new AgentEventService();
    return instance;
  }

  private constructor(private readonly isApi = false) {}

  private storyCount?: number;

  setStoryCount(count: number): void {
    this.storyCount = count;
  }

  private formatContext(story?: number, iteration?: number): string {
    return [
      story && `story ${story}${this.storyCount ? `/${this.storyCount}` : ""}`,
      iteration && `iter ${iteration}`,
    ]
      .filter(Boolean)
      .join(" · ");
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
    const emit = (content: string) =>
      this.emit(content, agent, story, iteration);
    const context = this.formatContext(story, iteration);
    const label = `${COLOR}${
      context ? `${context} · ${agent.name}` : agent.name
    }${RESET}`;
    const thinking = new ThinkingAnimation(label);

    emit("starting...\n");
    let isStreamBeginning = true;
    let streamNeedsNewline = false;

    session.subscribe((event: AgentSessionEvent) => {
      if (!(
        event.type === "message_update" &&
        event.assistantMessageEvent.type.includes("delta")
      )) {
        this.writeLog(event, agent, story, iteration);
      }

      switch (event.type) {
        case "message_update":
          switch (event.assistantMessageEvent.type) {
            case "thinking_start":
              thinking.start();
              break;
            case "thinking_end":
              thinking.stop();
              break;
            case "text_delta": {
              thinking.stop();
              if (isStreamBeginning) {
                emit("\n");
                isStreamBeginning = false;
              }
              const delta = event.assistantMessageEvent.delta;
              this.emit(delta);
              streamNeedsNewline = !delta.endsWith("\n");
              break;
            }
          }
          break;
        case "message_end":
          thinking.stop();
          if (streamNeedsNewline) {
            streamNeedsNewline = false;
            writeOutput("\n");
          }
          isStreamBeginning = true;
          break;
        case "tool_execution_start":
          thinking.stop();
          emit(
            `${event.toolName}${this.formatToolDetails(
              event.toolName,
              event.args,
            )}\n`,
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

  emit(content: string, agent?: Agent, story?: number, iteration?: number) {
    if (!this.isApi) {
      const context = this.formatContext(story, iteration);
      const label =
        agent &&
        `${COLOR}${
          context ? `${context} · ${agent.name}` : agent.name
        }${RESET}: `;
      writeOutput(label ? `${label}${content}` : content);
    }
    broadcast(content);
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

  constructor(private readonly label: string) {}

  start(): void {
    this.stop();
    this.index = 0;
    writeOutput(`\r\x1b[K${this.label}: ${this.frames[0]}`);
    this.timer = setInterval(() => {
      this.index = (this.index + 1) % this.frames.length;
      writeOutput(`\r\x1b[K${this.label}: ${this.frames[this.index]}`);
    }, 300);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    writeOutput("\r\x1b[K");
  }
}
