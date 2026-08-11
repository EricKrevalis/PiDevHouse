import type { Message } from "./message.model.ts";

export interface MessagePublisher {
  publish(message: Message): void;
}
