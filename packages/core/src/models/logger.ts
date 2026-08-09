export interface Logger {
  response(): string;
  complete(): void;
  fail(error: unknown): void;
  flush(): Promise<void>;
}
