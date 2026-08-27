import assert from "node:assert/strict";
import { it } from "vitest";
import {
  extractBacktrack,
  extractBacktrackFromJsonl,
  type LogLine,
} from "../backtrackExtractor.ts";

// helper: one tool_execution_end line.
function end(agentName: string, toolName: string, isError: boolean): LogLine {
  return { type: "tool_execution_end", agentName, toolName, isError };
}

it("basic rate: 1 of 4 bash calls failed -> 0.25", () => {
  const lines: LogLine[] = [
    end("developer", "bash", false),
    end("developer", "bash", true),
    end("developer", "bash", false),
    end("developer", "bash", false),
  ];
  const report = extractBacktrack(lines);
  assert.equal(report.overall.totalCalls, 4);
  assert.equal(report.overall.failedCalls, 1);
  assert.equal(report.overall.backtrackRate, 0.25);
  assert.deepEqual(report.overall.failuresByTool, { bash: 1 });
});

it("ignores non-tool events when counting", () => {
  const lines: LogLine[] = [
    { type: "tool_execution_start", agentName: "developer", toolName: "bash" },
    { type: "message_update", agentName: "developer" },
    end("developer", "bash", true),
    end("developer", "bash", false),
  ];
  const report = extractBacktrack(lines);
  // only the two tool_execution_end lines count.
  assert.equal(report.overall.totalCalls, 2);
  assert.equal(report.overall.failedCalls, 1);
  assert.equal(report.overall.backtrackRate, 0.5);
});

it("keeps multiple agents separate", () => {
  const lines: LogLine[] = [
    end("developer", "bash", true),
    end("developer", "bash", true),
    end("developer", "edit", false),
    end("tester", "bash", false),
    end("tester", "bash", true),
  ];
  const report = extractBacktrack(lines);
  assert.equal(report.perAgent.length, 2);

  // sorted by name: developer before tester.
  const [developer, tester] = report.perAgent;
  assert.equal(developer.agentName, "developer");
  assert.equal(developer.totalCalls, 3);
  assert.equal(developer.failedCalls, 2);
  assert.equal(developer.backtrackRate, 2 / 3);
  assert.deepEqual(developer.failuresByTool, { bash: 2 });

  assert.equal(tester.agentName, "tester");
  assert.equal(tester.totalCalls, 2);
  assert.equal(tester.failedCalls, 1);
  assert.equal(tester.backtrackRate, 0.5);
  assert.deepEqual(tester.failuresByTool, { bash: 1 });

  // overall folds both agents together.
  assert.equal(report.overall.totalCalls, 5);
  assert.equal(report.overall.failedCalls, 3);
  assert.deepEqual(report.overall.failuresByTool, { bash: 3 });
});

it("zero tool calls -> rate 0, not NaN", () => {
  const lines: LogLine[] = [
    { type: "agent_start", agentName: "developer" },
    { type: "message_end", agentName: "developer" },
  ];
  const report = extractBacktrack(lines);
  assert.equal(report.overall.totalCalls, 0);
  assert.equal(report.overall.failedCalls, 0);
  assert.equal(report.overall.backtrackRate, 0);
  assert.ok(!Number.isNaN(report.overall.backtrackRate));
  assert.equal(report.perAgent.length, 0);
});

it("every call fails -> rate 1", () => {
  const lines: LogLine[] = [
    end("developer", "bash", true),
    end("developer", "bash", true),
    end("developer", "edit", true),
  ];
  const report = extractBacktrack(lines);
  assert.equal(report.overall.backtrackRate, 1);
  assert.equal(report.overall.failedCalls, 3);
  assert.deepEqual(report.overall.failuresByTool, { bash: 2, edit: 1 });
});

it("per-tool failure breakdown counts each tool independently", () => {
  const lines: LogLine[] = [
    end("developer", "bash", true),
    end("developer", "bash", true),
    end("developer", "bash", true),
    end("developer", "edit", true),
    end("developer", "read", false),
    end("developer", "write", false),
  ];
  const report = extractBacktrack(lines);
  assert.equal(report.overall.totalCalls, 6);
  assert.equal(report.overall.failedCalls, 4);
  // read and write succeeded, so they never appear in failuresByTool.
  assert.deepEqual(report.overall.failuresByTool, { bash: 3, edit: 1 });
});

it("parses raw JSONL, skipping blank lines", () => {
  const jsonl = [
    JSON.stringify(end("developer", "bash", true)),
    "",
    JSON.stringify(end("developer", "bash", false)),
    "   ",
  ].join("\n");
  const report = extractBacktrackFromJsonl(jsonl);
  assert.equal(report.overall.totalCalls, 2);
  assert.equal(report.overall.failedCalls, 1);
  assert.equal(report.overall.backtrackRate, 0.5);
});

it("reports the offending line number on malformed JSONL", () => {
  const jsonl = [
    JSON.stringify(end("developer", "bash", true)),
    "{ not json",
  ].join("\n");
  assert.throws(() => extractBacktrackFromJsonl(jsonl), /line 2/);
});
