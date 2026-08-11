import { Message } from "../model/message.model.ts";
import {
  EventBus,
  type MessageSubscriber,
} from "../service/eventBus.service.ts";

const COLOR = "\x1b[36m";
const RESET = "\x1b[0m";
function writeOutput(message: string): void {
  process.stdout.write(message);
}

interface AgentScope {
  agent: string;
  storyId?: number;
  iteration?: number;
}

export class TerminalView implements MessageSubscriber {
  constructor(private readonly eventBus: EventBus) {
    this.eventBus.subscribe(this);
  }

  private readonly thinking = new ThinkingAnimation();
  private storyCount?: number;
  // ponytail: single shared stream state is fine for default concurrency 1;
  // parallel runs interleave on one stdout anyway
  private isStreamBeginning = true;
  private streamNeedsNewline = false;

  close(): void {
    this.thinking.stop();
    this.eventBus.unsubscribe(this);
  }

  handle(message: Message): void {
    switch (message.type) {
      case "agent_start":
        this.writeLabel(message, "starting...\n");
        break;
      case "agent_end":
      case "text_end":
        this.stopStream(message);
        break;
      case "text_delta":
        this.thinking.stop();
        if (this.isStreamBeginning) {
          this.writeLabel(message, "\n");
          this.isStreamBeginning = false;
        }
        writeOutput(message.delta);
        this.streamNeedsNewline = !message.delta.endsWith("\n");
        break;
      case "thinking_start":
        this.thinking.setLabel(this.label(message));
        this.thinking.start();
        break;
      case "thinking_end":
        this.thinking.stop();
        break;
      case "tool_start":
        this.thinking.stop();
        this.writeLabel(
          message,
          `${message.tool}${this.formatToolDetails(message.tool, message.args)}\n`,
        );
        break;
      case "tool_end":
        if (message.isError) {
          this.writeLabel(
            message,
            `Error executing tool ${message.tool}: ${message.result}\n`,
          );
        }
        break;
      case "story_score":
        writeOutput(
          `\nStory ${message.storyId} ${message.variant}_score: ${message.score}\n`,
        );
        break;
      case "story_blocked":
        writeOutput(
          `\nStory ${message.storyId} marked blocked: ${message.detail}\n`,
        );
        break;
      case "run_status":
        this.renderRunStatus(message);
        break;
      case "run_info":
        this.storyCount = message.totalStories;
        break;
      case "elapsed":
        writeOutput(
          `\r\x1b[K\x1b[36melapsed: ${this.formatElapsed(message.seconds)}\x1b[0m\n`,
        );
        break;
    }
  }

  private formatElapsed(seconds: number): string {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  private stopStream(message: AgentScope): void {
    this.thinking.stop();
    if (this.streamNeedsNewline) {
      this.streamNeedsNewline = false;
      writeOutput("\n");
    }
    this.isStreamBeginning = true;
  }

  private renderRunStatus(
    message: Extract<Message, { type: "run_status" }>,
  ): void {
    if (message.status !== "retry") this.thinking.stop();
    switch (message.status) {
      case "retry":
        writeOutput(`\nProduct Owner retry ${message.attempt}\n`);
        break;
      case "completed":
        writeOutput(`\n=== Run completed ===\nOutput: ${message.outputDir}\n`);
        break;
      case "incomplete":
        writeOutput(`\n=== Run incomplete ===\n${message.detail}\n`);
        break;
      case "blocked":
        writeOutput(`\n=== Run blocked ===\n${message.detail}\n`);
        break;
      case "failed":
        if (message.outcome) {
          writeOutput(
            `\n=== Run failed (${message.outcome}) ===\n${message.error ?? message.detail ?? ""}\n`,
          );
        } else {
          writeOutput(`\n${message.detail}\n`);
        }
        break;
      case "cancelled":
        writeOutput(
          `\n=== Run cancelled ===\n${message.detail ?? message.error}\n`,
        );
        break;
    }
  }

  private formatContext(story?: number, iteration?: number): string {
    return [
      story && `story ${story}${this.storyCount ? `/${this.storyCount}` : ""}`,
      iteration && `iter ${iteration}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  private formatToolDetails(
    toolName: string,
    args?: Record<string, unknown>,
  ): string {
    if (!args) return "";

    if (toolName === "bash" && typeof args.command === "string") {
      const command =
        args.command.slice(0, 500) + (args.command.length > 500 ? "..." : "");
      return `\n  $ ${command}`;
    }

    const path = args.path ?? args.file_path;
    return typeof path === "string" ? `\n  path: ${path}` : "";
  }

  private label(message: AgentScope): string {
    const context = this.formatContext(message.storyId, message.iteration);
    return `${COLOR}${
      context ? `${context} · ${message.agent}` : message.agent
    }${RESET}: `;
  }

  private writeLabel(message: AgentScope, content: string): void {
    writeOutput(`${this.label(message)}${content}`);
  }
}

class ThinkingAnimation {
  private timer: ReturnType<typeof setInterval> | undefined;
  private index = 0;
  private label = "";
  private readonly frames = [
    "thinking",
    "thinking.",
    "thinking..",
    "thinking...",
  ];

  setLabel(label: string): void {
    this.label = label;
  }

  start(): void {
    this.stop();
    this.index = 0;
    writeOutput(`\r\x1b[K${this.label}${this.frames[0]}`);
    this.timer = setInterval(() => {
      this.index = (this.index + 1) % this.frames.length;
      writeOutput(`\r\x1b[K${this.label}${this.frames[this.index]}`);
    }, 300);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    writeOutput("\r\x1b[K");
  }
}
