import type { MessagePublisher } from "../modules/model/messagePublisher.model.ts";

export class Timer {
  private startTime = Date.now();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly runId: string,
    private readonly messagePublisher: MessagePublisher,
  ) {}

  start(): void {
    this.startTime = Date.now();
    this.timer = setInterval(() => {
      this.messagePublisher.publish({
        type: "elapsed",
        runId: this.runId,
        seconds: Math.floor(this.elapsedMs() / 1000),
        timestamp: new Date().toISOString(),
      });
    }, 10_000);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  elapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
