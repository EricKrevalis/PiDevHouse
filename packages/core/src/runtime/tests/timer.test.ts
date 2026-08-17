import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { EventBus } from "../../modules/service/eventBus.service.ts";
import { Timer } from "../timer.ts";

it("publishes elapsed time every second", () => {
  vi.useFakeTimers();
  const eventBus = new EventBus();
  const elapsed: number[] = [];
  eventBus.subscribe({
    handle(message) {
      if (message.type === "elapsed") elapsed.push(message.seconds);
    },
  });
  const timer = new Timer("run-1", eventBus);

  timer.start();
  vi.advanceTimersByTime(1_000);

  assert.deepEqual(elapsed, [1]);
  timer.stop();
  vi.useRealTimers();
});
