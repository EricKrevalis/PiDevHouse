import { expect, test } from "bun:test";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  Agent,
} from "@earendil-works/pi-agent-core";
import { trimToolOutputs } from "../src/modules/tools/trim";

type Hook = NonNullable<Agent["afterToolCall"]>;

function makeContext(content: unknown): AfterToolCallContext {
  return { result: { content } } as never;
}

function makeAgent(after?: Hook): { afterToolCall?: Hook } {
  const agent: { afterToolCall?: Hook } = {};
  if (after) agent.afterToolCall = after;
  trimToolOutputs(agent as never, 1_000);
  return agent;
}

test("leaves short tool results untouched", async () => {
  const agent = makeAgent();
  const result = await agent.afterToolCall!(
    makeContext([{ type: "text", text: "small output" }]),
  );
  expect(result).toBeUndefined();
});

test("trims oversized tool output keeping head and tail", async () => {
  const agent = makeAgent();
  const text = "A".repeat(900) + "B".repeat(500);
  const result = await agent.afterToolCall!(
    makeContext([{ type: "text", text }]),
  );
  const trimmed = result!.content![0] as { type: string; text: string };
  expect(trimmed.text.startsWith("A".repeat(666))).toBe(true);
  expect(trimmed.text.endsWith("B".repeat(334))).toBe(true);
  expect(trimmed.text).toContain("characters trimmed");
  expect(trimmed.text.length).toBeLessThan(1_100);
});

test("passes through images and chains the original hook", async () => {
  const originalResult: AfterToolCallResult = {
    content: [{ type: "text", text: "original" }],
  };
  const agent = makeAgent(async () => originalResult);

  const short = await agent.afterToolCall!(
    makeContext([{ type: "image", data: "abc" }, { type: "text", text: "tiny" }]),
  );
  expect(short).toEqual(originalResult);

  const big = await agent.afterToolCall!(
    makeContext([{ type: "text", text: "x".repeat(5_000) }]),
  );
  expect((big!.content![0] as { text: string }).text).toContain(
    "characters trimmed",
  );
});
