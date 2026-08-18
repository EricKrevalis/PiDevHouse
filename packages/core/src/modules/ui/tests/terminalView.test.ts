import assert from "node:assert/strict";
import { it } from "vitest";
import { EventBus } from "../../service/eventBus.service.ts";
import { TerminalView } from "../terminalView.tsx";

it("updates the elapsed display", async () => {
  const eventBus = new EventBus();
  const view = new TerminalView({ eventBus });

  eventBus.publish({
    type: "elapsed",
    runId: "run-1",
    seconds: 61,
    timestamp: new Date().toISOString(),
  });

  assert.equal(view.elapsed, "1m 1s");
  await view.close();
});

it("colors agent labels cyan", async () => {
  const eventBus = new EventBus();
  const view = new TerminalView({ eventBus });

  eventBus.publish({
    type: "agent_start",
    runId: "run-1",
    agent: "developer",
    timestamp: new Date().toISOString(),
  });

  assert.deepEqual(view.output, [
    { content: "developer: ", color: "cyan" },
    { content: "starting...\n", color: undefined },
  ]);
  await view.close();
});
