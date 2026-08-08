const textEncoder = new TextEncoder();

export class RunTimer {
  private startTime = Date.now();
  private timer: ReturnType<typeof setInterval> | undefined;

  start(): void {
    this.startTime = Date.now();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.tick();
    Deno.stdout.writeSync(textEncoder.encode("\n"));
  }

  private tick(): void {
    Deno.stdout.writeSync(
      textEncoder.encode(`\r\x1b[Kelapsed: ${this.format()}`),
    );
  }

  private format(): string {
    const totalSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }
}
