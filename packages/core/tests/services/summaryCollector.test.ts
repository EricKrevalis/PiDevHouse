import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SummaryCollector } from "../../src/modules/services/summaryCollector";

let directory: string;

afterEach(() => rm(directory, { recursive: true }));

test("uses reported reasoning tokens instead of also adding an estimate", async () => {
  directory = await mkdtemp(join(tmpdir(), "pidev-summary-"));
  const collector = new SummaryCollector();
  const record = (
    collector as unknown as {
      record: (...args: unknown[]) => void;
    }
  ).record.bind(collector);

  record(
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "12345678" },
    },
    "reviewer",
  );
  record(
    {
      type: "message_end",
      message: {
        role: "assistant",
        usage: { input: 1, output: 1, reasoning: 3 },
      },
    },
    "reviewer",
  );
  await collector.writeSummary(directory, {
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    durationSeconds: 1,
    request: "test",
    outcome: "completed",
    stories: [],
  });

  const summary = JSON.parse(
    await readFile(join(directory, "summary.json"), "utf8"),
  );
  expect(summary.agents.reviewer.reasoningTokens).toBe(3);
});
