import type { MessageBus } from "../modules/services/messageBus";

export function startTimer(bus: MessageBus): () => void {
  const startedAt = Date.now();
  const interval = setInterval(() => {
    bus.publish({
      type: "elapsed",
      seconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  }, 1_000);
  interval.unref();
  return () => clearInterval(interval);
}
