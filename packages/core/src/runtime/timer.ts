export class Timer {
  private startTime = Date.now();
  private timer: ReturnType<typeof setInterval> | undefined;

  start(): void {
    this.startTime = Date.now();
    this.timer = setInterval(() => {
      Deno.stdout.writeSync(
        new TextEncoder().encode(
          `\r\x1b[K\x1b[36melapsed: ${this.format()}\x1b[0m\n`,
        ),
      );
    }, 10_000);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private format(): string {
    const totalSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }
}
