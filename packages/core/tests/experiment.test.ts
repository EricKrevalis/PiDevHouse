import { expect, test } from "bun:test";
import {
  formatRunStatus,
  forwardWorkerMessages,
  trialsForExperiment,
} from "../scripts/experiment";

test("finishes every task before the next task", () => {
  const variants = ["baseline", "one-iteration", "short-timeout"];
  const tasks = ["todo", "expenses"];

  expect(trialsForExperiment(tasks, variants, 2)).toEqual([
    { task: "todo", variant: "baseline", run: 1 },
    { task: "todo", variant: "baseline", run: 2 },
    { task: "todo", variant: "one-iteration", run: 1 },
    { task: "todo", variant: "one-iteration", run: 2 },
    { task: "todo", variant: "short-timeout", run: 1 },
    { task: "todo", variant: "short-timeout", run: 2 },
    { task: "expenses", variant: "baseline", run: 1 },
    { task: "expenses", variant: "baseline", run: 2 },
    { task: "expenses", variant: "one-iteration", run: 1 },
    { task: "expenses", variant: "one-iteration", run: 2 },
    { task: "expenses", variant: "short-timeout", run: 1 },
    { task: "expenses", variant: "short-timeout", run: 2 },
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
