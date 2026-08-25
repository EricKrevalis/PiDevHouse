import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Message } from "../models/message.model.ts";
import type { Path } from "typescript";
import { LOG_FILE } from "../models/config.model.ts";

type Listener = (message: Message) => void;

export class MessageBus {
  private readonly listeners = new Set<Listener>();
  private readonly logFile: Path;

  constructor(workspace: Path) {
    this.logFile = resolve(workspace, LOG_FILE) as Path;
  }

  publish(message: Message): void {
    if (this.logFile) this.log(message);
    for (const listener of this.listeners) listener(message);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private log(message: Message): void {
    appendFileSync(this.logFile, `${JSON.stringify(message)}\n`);
  }
}
