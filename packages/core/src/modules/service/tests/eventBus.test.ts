import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { EventBus } from "../eventBus.service.ts";

it("publishes typed messages to subscribers", () => {
  let received = false;
  const runId = `test-${randomUUID()}`;

  EventBus.getInstance().subscribe({
    handle(message) {
      if (message.type === "run_info" && message.runId === runId) {
        received = message.totalStories === 2;
      }
    },
  });

  EventBus.getInstance().publish({
    type: "run_info",
    runId,
    totalStories: 2,
    timestamp: new Date().toISOString(),
  });

  assert.equal(received, true);
});
