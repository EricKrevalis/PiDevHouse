import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { Message } from "../model/message.model.ts";
import {
  EventBus,
  type MessageSubscriber,
} from "../service/eventBus.service.ts";
import { TerminalScreen } from "./terminalScreen.tsx";
import { TerminalState, type OutputSegment } from "./terminalState.ts";

interface AgentScope {
  agent: string;
  storyId?: number;
  iteration?: number;
}

interface TerminalViewOptions {
  eventBus: EventBus;
}

interface TerminalViewCreateOptions {
  eventBus: EventBus;
  renderer?: CliRenderer;
}

export class TerminalView implements MessageSubscriber {
  private readonly state = new TerminalState();
  private renderer?: CliRenderer;
  private storyCount?: number;
  private isStreamBeginning = true;
  private streamNeedsNewline = false;

  constructor(private readonly options: TerminalViewOptions) {
    this.options.eventBus.subscribe(this);
  }

  static async create({
    eventBus,
    renderer,
  }: TerminalViewCreateOptions): Promise<TerminalView> {
    if (renderer === undefined) {
      renderer = await createCliRenderer({
        clearOnShutdown: false,
        exitOnCtrlC: false,
        exitSignals: [],
        screenMode: "main-screen",
      });
    }

    const terminalView = new TerminalView({ eventBus });
    terminalView.renderer = renderer;
    await render(
      () => <TerminalScreen terminal={terminalView.state} />,
      renderer,
    );
    return terminalView;
  }

  get output(): OutputSegment[] {
    return this.state.output;
  }

  get elapsed(): string {
    return this.state.elapsed;
  }

  get signal(): AbortSignal {
    return this.state.signal;
  }

  cancel(): void {
    this.state.cancel();
  }

  write(content: string, color?: string): void {
    this.state.write(content, color);
  }

  async close(): Promise<void> {
    this.stopThinking();
    this.options.eventBus.unsubscribe(this);
    if (!this.renderer || this.renderer.isDestroyed) return;
    await this.renderer.idle();
    this.renderer.destroy();
  }

  handle(message: Message): void {
    switch (message.type) {
      case "agent_start":
        this.writeLabel(message, "starting...\n");
        break;
      case "agent_end":
      case "text_end":
        this.stopStream();
        break;
      case "text_delta":
        this.stopThinking();
        if (this.isStreamBeginning) {
          this.writeLabel(message, "\n");
          this.isStreamBeginning = false;
        }
        this.state.write(message.delta);
        this.streamNeedsNewline = !message.delta.endsWith("\n");
        break;
      case "thinking_start":
        this.state.startThinking(this.label(message));
        break;
      case "thinking_end":
        this.stopThinking();
        break;
      case "tool_start":
        this.stopThinking();
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
        this.state.write(
          `\nStory ${message.storyId} ${message.variant}_score: ${message.score}\n`,
        );
        break;
      case "story_blocked":
        this.state.write(
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
        this.state.setElapsed(message.seconds);
        break;
    }
  }

  private stopStream(): void {
    this.stopThinking();
    if (this.streamNeedsNewline) {
      this.streamNeedsNewline = false;
      this.state.write("\n");
    }
    this.isStreamBeginning = true;
  }

  private renderRunStatus(
    message: Extract<Message, { type: "run_status" }>,
  ): void {
    if (message.status !== "retry") this.stopThinking();
    switch (message.status) {
      case "retry":
        this.state.write(`\nProduct Owner retry ${message.attempt ?? ""}\n`);
        break;
      case "completed":
        this.state.write(
          `\n=== Run completed ===\nOutput: ${message.outputDir ?? ""}\n`,
        );
        break;
      case "incomplete":
        this.state.write(`\n=== Run incomplete ===\n${message.detail ?? ""}\n`);
        break;
      case "blocked":
        this.state.write(`\n=== Run blocked ===\n${message.detail ?? ""}\n`);
        break;
      case "failed":
        if (message.outcome) {
          this.state.write(
            `\n=== Run failed (${message.outcome}) ===\n${message.error ?? message.detail ?? ""}\n`,
          );
        } else {
          this.state.write(`\n${message.detail ?? ""}\n`);
        }
        break;
      case "cancelled":
        this.state.write(
          `\n=== Run cancelled ===\n${message.detail ?? message.error ?? ""}\n`,
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
    return context ? `${context} · ${message.agent}: ` : `${message.agent}: `;
  }

  private writeLabel(message: AgentScope, content: string): void {
    this.state.write(this.label(message), "cyan");
    this.state.write(content);
  }

  private stopThinking(): void {
    this.state.stopThinking();
  }
}
