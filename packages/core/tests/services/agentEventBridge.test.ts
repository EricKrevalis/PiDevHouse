import { expect, test } from "bun:test";
import { AgentEventBridge } from "../../src/modules/services/agentEventBridge";

test("publishes retry context", () => {
  const messages: unknown[] = [];
  const bridge = new AgentEventBridge({
    publish: (message: unknown) => messages.push(message),
  } as never);

  bridge.retry(
    { agent: "reviewer", storyId: 7, iteration: 2 },
    "Retry requested.",
  );

  expect(messages[0]).toMatchObject({
    type: "agent_retry",
    agent: "reviewer",
    storyId: 7,
    iteration: 2,
    message: "Retry requested.",
  });
});

test("publishes text boundaries only for assistant messages", () => {
  const messages: Array<{ type: string }> = [];
  let listener: (event: unknown) => void = () => {};
  const bridge = new AgentEventBridge({
    publish: (message: { type: string }) => messages.push(message),
  } as never);
  bridge.attach(
    {
      subscribe: (callback: (event: unknown) => void) => {
        listener = callback;
      },
    } as never,
    { agent: "developer" },
  );
  messages.length = 0;

  listener({ type: "message_end", message: { role: "user" } });
  listener({ type: "message_end", message: { role: "toolResult" } });
  listener({ type: "message_end", message: { role: "assistant" } });

  expect(messages.map((message) => message.type)).toEqual(["text_end"]);
});
