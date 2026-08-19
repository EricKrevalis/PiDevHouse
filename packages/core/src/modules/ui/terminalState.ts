import { createSignal } from "solid-js";

export interface OutputSegment {
  content: string;
  color?: string;
}

interface ThinkingState {
  label: string;
  index: number;
}

export class TerminalState {
  private readonly outputState = createSignal<OutputSegment[]>([]);
  private readonly thinkingState = createSignal<ThinkingState | undefined>(
    undefined,
  );
  private readonly elapsedState = createSignal(0);
  private readonly thinkingFrames = [
    "thinking",
    "thinking.",
    "thinking..",
    "thinking...",
  ];
  private readonly cancellation = new AbortController();
  private thinkingTimer: ReturnType<typeof setInterval> | undefined;

  get output(): OutputSegment[] {
    return this.outputState[0]();
  }

  get thinkingLabel(): string {
    return this.thinkingState[0]()?.label ?? "";
  }

  get thinkingFrame(): string {
    const thinking = this.thinkingState[0]();
    return thinking ? this.thinkingFrames[thinking.index] : "";
  }

  get elapsed(): string {
    const seconds = this.elapsedState[0]();
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  get signal(): AbortSignal {
    return this.cancellation.signal;
  }

  cancel(): void {
    this.cancellation.abort();
  }

  write(content: string, color?: string): void {
    const output = this.output;
    const previous = output.at(-1);
    if (previous && previous.color === color) {
      this.outputState[1]([
        ...output.slice(0, -1),
        { content: `${previous.content}${content}`, color },
      ]);
      return;
    }
    this.outputState[1]([...output, { content, color }]);
  }

  setElapsed(seconds: number): void {
    this.elapsedState[1](seconds);
  }

  startThinking(label: string): void {
    this.stopThinking();
    this.thinkingState[1]({ label, index: 0 });
    this.thinkingTimer = setInterval(() => {
      const thinking = this.thinkingState[0]();
      if (!thinking) return;
      this.thinkingState[1]({
        ...thinking,
        index: (thinking.index + 1) % this.thinkingFrames.length,
      });
    }, 300);
  }

  stopThinking(): void {
    if (this.thinkingTimer !== undefined) {
      clearInterval(this.thinkingTimer);
      this.thinkingTimer = undefined;
    }
    this.thinkingState[1](undefined);
  }
}
