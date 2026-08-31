import { expect, test } from "bun:test";
import {
  formatRunStatus,
  forwardWorkerMessages,
  trialsForExperiment,
} from "../scripts/experiment";

test("expands per-task variants and repeats", () => {
  const spec = {
    tasks: [
      {
        name: "todo",
        request: "build a todo app",
        repeat: 2,
        variants: [{ name: "baseline", config: {} }],
      },
      {
        name: "expenses",
        request: "build an expenses app",
        repeat: 2,
        variants: [
          { name: "baseline", config: {} },
          { name: "one-iteration", config: {} },
        ],
      },
    ],
  } as never;

  expect(trialsForExperiment(spec)).toEqual([
    { task: { name: "todo", request: "build a todo app", repeat: 2, variants: [{ name: "baseline", config: {} }] }, variant: { name: "baseline", config: {} }, run: 1 },
    { task: { name: "todo", request: "build a todo app", repeat: 2, variants: [{ name: "baseline", config: {} }] }, variant: { name: "baseline", config: {} }, run: 2 },
    { task: { name: "expenses", request: "build an expenses app", repeat: 2, variants: [{ name: "baseline", config: {} }, { name: "one-iteration", config: {} }] }, variant: { name: "baseline", config: {} }, run: 1 },
    { task: { name: "expenses", request: "build an expenses app", repeat: 2, variants: [{ name: "baseline", config: {} }, { name: "one-iteration", config: {} }] }, variant: { name: "baseline", config: {} }, run: 2 },
    { task: { name: "expenses", request: "build an expenses app", repeat: 2, variants: [{ name: "baseline", config: {} }, { name: "one-iteration", config: {} }] }, variant: { name: "one-iteration", config: {} }, run: 1 },
    { task: { name: "expenses", request: "build an expenses app", repeat: 2, variants: [{ name: "baseline", config: {} }, { name: "one-iteration", config: {} }] }, variant: { name: "one-iteration", config: {} }, run: 2 },
  ]);
});

test("shows the underlying run error in experiment status", () => {
  expect(
    formatRunStatus({
      outcome: "error",
      error: {
        name: "Error",
        message: "preflight failed",
        cause: { name: "TimeoutError", message: "model load timed out" },
      },
    } as never),
  ).toBe("error · model load timed out");
});

test("coalesces streamed worker text", async () => {
  const messages: unknown[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const text = [
        '{"type":"message","message":{"type":"text_delta","agent":"developer","delta":"work","timestamp":"now"}}',
        '{"type":"message","message":{"type":"text_delta","agent":"developer","delta":"ing","timestamp":"now"}}',
        '{"type":"message","message":{"type":"text_end","agent":"developer","timestamp":"now"}}',
        '{"type":"message","message":{"type":"elapsed","seconds":2,"timestamp":"now"}}',
      ].join("\n") + "\n";
      controller.enqueue(new TextEncoder().encode(text.slice(0, 30)));
      controller.enqueue(new TextEncoder().encode(text.slice(30)));
      controller.close();
    },
  });

  await forwardWorkerMessages(stream, (message) => messages.push(message));

  expect(messages).toEqual([
    {
      type: "text_delta",
      agent: "developer",
      delta: "working",
      timestamp: "now",
    },
    { type: "text_end", agent: "developer", timestamp: "now" },
    { type: "elapsed", seconds: 2, timestamp: "now" },
  ]);
});
