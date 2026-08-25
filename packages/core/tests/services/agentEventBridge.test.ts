import { expect, test } from "bun:test";
import { AgentEventBridge } from "../../src/modules/services/agentEventBridge";

test("publishes retry context", () => {
  const messages: unknown[] = [];
  const bridge = new AgentEventBridge({
    publish: (message: unknown) => messages.push(message),
  } as never);

  bridge.retry(
    { agent: "reviewer", storyId: 7, iteration: 2 },
    "No fresh review result was recorded.",
  );

  expect(messages[0]).toMatchObject({
    type: "agent_retry",
    agent: "reviewer",
    storyId: 7,
    iteration: 2,
    message: "No fresh review result was recorded.",
  });
});
