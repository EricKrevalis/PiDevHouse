import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Message } from "../models/message.model.ts";
import type { Path } from "typescript";
import { LOG_FILE } from "../models/config.model.ts";

type Listener = (message: Message) => void;

// Streaming/markup events: needed by the TUI, not by the log.
const UNLOGGED = new Set<Message["type"]>([
  "elapsed",
  "text_delta",
  "thinking_start",
  "thinking_end",
]);

export class MessageBus {
  private readonly listeners = new Set<Listener>();
  private readonly logFile: Path;
  private logQueue: Promise<void> = Promise.resolve();

  constructor(workspace: Path) {
    this.logFile = resolve(workspace, LOG_FILE) as Path;
  }

  publish(message: Message): void {
    if (this.logFile && !UNLOGGED.has(message.type)) this.log(message);
    for (const listener of this.listeners) listener(message);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private log(message: Message): void {
    this.logQueue = this.logQueue
      .then(() => appendFile(this.logFile, `${JSON.stringify(message)}\n`))
      .catch(() => {});
  }
}
