import type { Message } from "../model/message.model.ts";
import type { MessagePublisher } from "../model/messagePublisher.model.ts";

export interface MessageSubscriber {
  handle(message: Message): void;
}

export class EventBus implements MessagePublisher {
  private readonly subscribers = new Set<MessageSubscriber>();

  subscribe(subscriber: MessageSubscriber): void {
    this.subscribers.add(subscriber);
  }

  unsubscribe(subscriber: MessageSubscriber): void {
    this.subscribers.delete(subscriber);
  }

  publish(message: Message): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber.handle(message);
      } catch (error) {
        console.error(`EventBus subscriber error: ${error}`);
      }
    }
  }
}
