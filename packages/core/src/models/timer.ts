export class RunTimer {
  readonly #startedAt = performance.now();

  elapsedMs(): number {
    return performance.now() - this.#startedAt;
  }

  formatElapsed(): string {
    const elapsedSeconds = Math.floor(this.elapsedMs() / 1_000);
    const mins = Math.floor(elapsedSeconds / 60);
    return `${mins > 0 ? mins + "m " : ""}${elapsedSeconds % 60}s`;
  }
}
