import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { it } from "vitest";
import { AgentEventBridge } from "../agentEventBridge.ts";
import type { Agent } from "../../model/agents/agent.model.ts";
import type { Message } from "../../model/message.model.ts";
import type { MessagePublisher } from "../../model/messagePublisher.model.ts";

it("logs structured tool errors as readable text", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "pidev-events-"));
  const messages: Message[] = [];
  let emit: (event: AgentSessionEvent) => void = () => {};
  const session = {
    subscribe(listener: (event: AgentSessionEvent) => void) {
      emit = listener;
      return () => {};
    },
  } as unknown as AgentSession;
  const agent = {
    name: "tester",
    runId: "run-1",
    workspace: { logDir },
  } as Agent;
  const publisher: MessagePublisher = {
    publish(message) {
      messages.push(message);
    },
  };

  new AgentEventBridge(publisher).attach(agent, session, 1, 1);
  emit({
    type: "tool_execution_end",
    toolCallId: "tool-1",
    toolName: "read",
    isError: true,
    result: {
      content: [{ type: "text", text: "permission denied" }],
      details: { path: "src/index.html" },
    },
  });

  const toolEnd = messages.find((message) => message.type === "tool_end");
  assert.equal(toolEnd && "result" in toolEnd ? toolEnd.result : undefined, "permission denied");
});
