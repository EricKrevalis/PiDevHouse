import { expect, test } from "bun:test";
import { reduceActivity } from "../../src/tui/activity";
import type { Message } from "../../src/modules/models/message.model";

const scope = {
  agent: "developer",
  timestamp: "2026-08-25T00:00:00.000Z",
} as const;

function render(messages: Message[]) {
  return messages.reduce(reduceActivity, []);
}

test("keeps one separator around a text response", () => {
  expect(
    render([
      { ...scope, type: "agent_start" },
      { ...scope, type: "text_delta", delta: "Working" },
      { ...scope, type: "text_delta", delta: " on it\n\n" },
      { ...scope, type: "text_end" },
      { ...scope, type: "text_end" },
    ]),
  ).toEqual([
    { type: "agent", agent: "developer" },
    { type: "text", text: "" },
    { type: "text", text: "Working on it" },
    { type: "text", text: "" },
  ]);
});

test("keeps one separator through tool transitions", () => {
  expect(
    render([
      { ...scope, type: "agent_start" },
      { ...scope, type: "text_delta", delta: "Checking.\n" },
      { ...scope, type: "text_end" },
      {
        ...scope,
        type: "tool_start",
        toolCallId: "call-1",
        tool: "read",
        args: { path: "src/index.ts", offset: 10 },
      },
      {
        ...scope,
        type: "tool_end",
        toolCallId: "call-1",
        tool: "read",
        isError: false,
      },
      { ...scope, type: "text_delta", delta: "Finished.\n" },
      { ...scope, type: "text_end" },
    ]),
  ).toEqual([
    { type: "agent", agent: "developer" },
    { type: "text", text: "" },
    { type: "text", text: "Checking." },
    { type: "text", text: "" },
    {
      type: "tool",
      toolCallId: "call-1",
      tool: "read",
      args: { path: "src/index.ts", offset: 10 },
      status: "done",
      result: undefined,
    },
    { type: "text", text: "Finished." },
    { type: "text", text: "" },
  ]);
});

test("formats story context without a hash", () => {
  expect(
    render([
      {
        ...scope,
        type: "agent_start",
        storyId: 7,
        iteration: 2,
      },
      {
        ...scope,
        type: "agent_retry",
        storyId: 7,
        iteration: 2,
        message: "Try again",
      },
      {
        type: "story_score",
        storyId: 7,
        variant: "review",
        score: 80,
        timestamp: scope.timestamp,
      },
    ]),
  ).toEqual([
    { type: "agent", agent: "developer", storyId: 7, iteration: 2 },
    { type: "text", text: "" },
    {
      type: "text",
      text: "retry · developer · story 7 · iteration 2 · Try again",
    },
    { type: "text", text: "" },
    { type: "text", text: "score story 7 · review  80" },
  ]);
});
