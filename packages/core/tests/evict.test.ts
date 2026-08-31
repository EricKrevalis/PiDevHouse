import { expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { evictStaleToolResults } from "../src/modules/tools/evict";

function makeResult(name: string, chars: number): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: `call-${name}`,
    toolName: name,
    content: [{ type: "text", text: "x".repeat(chars) }],
    isError: false,
    timestamp: 0,
  };
}

function makeHistory(sizes: number[]): AgentMessage[] {
  const messages: AgentMessage[] = [{ role: "user", content: "go" } as never];
  for (const [i, size] of sizes.entries()) {
    messages.push({ role: "assistant", content: [] } as never);
    messages.push(makeResult(`tool${i}`, size));
  }
  return messages;
}

test("below high water returns the same array (cache-stable)", async () => {
  const evict = evictStaleToolResults({
    highWaterChars: 10_000,
    lowWaterChars: 4_000,
    keepLast: 2,
  });
  const messages = makeHistory([100, 200, 300, 400, 500]);
  expect(await evict(messages)).toBe(messages);
});

test("above high water elides old results, keeps recent verbatim", async () => {
  const evict = evictStaleToolResults({
    highWaterChars: 10_000,
    lowWaterChars: 4_000,
    keepLast: 2,
  });
  // total 15k > 10k high water; walking back: tool4 (2k, keepLast) + tool3
  // (2k, keepLast) = 4k... tool2 would exceed lowWater -> elide tool0/tool1
  const messages = makeHistory([3_000, 3_000, 3_000, 2_000, 2_000]);
  const out = (await evict(messages)) as ToolResultMessage[];
  expect(out).not.toBe(messages);
  const results = out.filter((m) => m.role === "toolResult") as ToolResultMessage[];
  expect((results[0]!.content[0] as { text: string }).text).toContain(
    "tool0 output elided, 3000 chars",
  );
  expect((results[1]!.content[0] as { text: string }).text).toContain("tool1");
  expect((results[2]!.content[0] as { text: string }).text).toContain(
    "tool2 output elided",
  );
  expect(results[3]!.content[0]).toEqual({
    type: "text",
    text: "x".repeat(2_000),
  });
  expect(results[4]!.content[0]).toEqual({
    type: "text",
    text: "x".repeat(2_000),
  });
  // metadata preserved for the LLM binding
  expect(results[0]!.toolCallId).toBe("call-tool0");
  expect(results[0]!.isError).toBe(false);
});

test("keeps keepLast results verbatim even when huge", async () => {
  const evict = evictStaleToolResults({
    highWaterChars: 1_000,
    lowWaterChars: 500,
    keepLast: 3,
  });
  const messages = makeHistory([9_000, 9_000, 9_000, 9_000, 9_000]);
  const out = (await evict(messages)) as ToolResultMessage[];
  const results = out.filter((m) => m.role === "toolResult") as ToolResultMessage[];
  expect(results[0]!.content[0]).toEqual({
    type: "text",
    text: expect.stringContaining("elided"),
  });
  expect(results[2]!.content[0]).toEqual({
    type: "text",
    text: "x".repeat(9_000),
  });
  expect(results[3]!.content[0]).toEqual({
    type: "text",
    text: "x".repeat(9_000),
  });
  expect(results[4]!.content[0]).toEqual({
    type: "text",
    text: "x".repeat(9_000),
  });
});

test("deterministic and stable once below high water", async () => {
  const evict = evictStaleToolResults({
    highWaterChars: 10_000,
    lowWaterChars: 4_000,
    keepLast: 2,
  });
  const messages = makeHistory([3_000, 3_000, 3_000, 2_000, 2_000]);
  const once = await evict(messages);
  const twice = await evict(once);
  expect(twice).toBe(once);
  expect(await evict(messages)).toEqual(once);
});
