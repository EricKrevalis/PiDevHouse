import { Message } from "../model/message.model.ts";

export interface MessageHandler {
  handle(message: Message): void;
}

let instance: EventBus | undefined;

export class EventBus {
  static getInstance(): EventBus {
    instance ??= new EventBus();
    return instance;
  }

  private constructor() {}

  private readonly handlers = new Set<MessageHandler>();

  subscribe(handler: MessageHandler): void {
    this.handlers.add(handler);
  }

  publish(message: Message): void {
    for (const handler of this.handlers) {
      try {
        handler.handle(message);
      } catch (error) {
        console.error(`EventBus handler error: ${error}`);
      }
    }
  }
}
