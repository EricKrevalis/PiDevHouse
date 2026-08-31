// Reclassifies finished runs whose summary.json predates the failure-class
// fields. Rebuilds per-agent invocation timings from log/outputlog.jsonl and
// runs them through the same classifier the live aggregator uses, so post-hoc
// numbers and future numbers come from one rule.
//
//   bun --cwd packages/core scripts/reclassifyRuns.ts [outputRoot] [--json]

import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";
import type { AgentUsage, Summary } from "../src/modules/model/summary.model.ts";
import {
  classifyFailure,
  isInfrastructureFailure,
  type FailureClass,
} from "../src/modules/service/failureClassifier.ts";

const DEFAULT_OUTPUT_ROOT = fileURLToPath(
  new URL("../../../output", import.meta.url),
);

interface LogEvent {
  timestamp?: string;
  type?: string;
  agentName?: string;
  toolCallId?: string;
  toolName?: string;
}

export interface RunRecord {
  run: string;
  model: string;
  outcome: string;
  failureMode: string;
  durationSeconds: number;
  failureClass: FailureClass;
  infrastructure: boolean;
  timedOutInvocations: number;
  longestToolCallSeconds: number;
  longestToolCall?: { agent: string; tool: string; seconds: number };
}

function freshUsage(): AgentUsage {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalDurationMs: 0,
    invocations: 0,
    timedOutInvocations: 0,
    longestInvocationMs: 0,
    longestToolCallMs: 0,
  };
}

function millisBetween(from: string, to: string): number {
  return Date.parse(to) - Date.parse(from);
}

// rebuilds the timing fields the live SummaryCollector now records, from the
// agent_start/agent_end and tool_execution_start/end pairs the log already kept.
export function rebuildAgents(
  lines: string[],
  timeoutMinutes: number,
): {
  agents: Record<string, AgentUsage>;
  longestToolCall?: { agent: string; tool: string; seconds: number };
} {
  const agents: Record<string, AgentUsage> = {};
  const invocationStart = new Map<string, string>();
  const toolStart = new Map<string, { at: string; agent: string; tool: string }>();
  let longestToolCall: { agent: string; tool: string; seconds: number } | undefined;
  const budgetMs = timeoutMinutes * 60_000;

  for (const line of lines) {
    let event: LogEvent;
    try {
      event = JSON.parse(line) as LogEvent;
    } catch {
      continue;
    }
    const agent = event.agentName;
    const at = event.timestamp;
    if (agent === undefined || at === undefined) continue;
    const usage = (agents[agent] ??= freshUsage());

    if (event.type === "agent_start") {
      invocationStart.set(agent, at);
    } else if (event.type === "agent_end") {
      const startedAt = invocationStart.get(agent);
      if (startedAt === undefined) continue;
      invocationStart.delete(agent);
      const durationMs = millisBetween(startedAt, at);
      if (!Number.isFinite(durationMs) || durationMs < 0) continue;
      usage.totalDurationMs += durationMs;
      usage.invocations += 1;
      usage.longestInvocationMs = Math.max(
        usage.longestInvocationMs,
        durationMs,
      );
      if (budgetMs > 0 && durationMs >= budgetMs) usage.timedOutInvocations += 1;
    } else if (event.type === "tool_execution_start") {
      if (event.toolCallId !== undefined) {
        toolStart.set(event.toolCallId, {
          at,
          agent,
          tool: event.toolName ?? "unknown",
        });
      }
    } else if (event.type === "tool_execution_end") {
      if (event.toolCallId === undefined) continue;
      const started = toolStart.get(event.toolCallId);
      if (started === undefined) continue;
      toolStart.delete(event.toolCallId);
      const durationMs = millisBetween(started.at, at);
      if (!Number.isFinite(durationMs) || durationMs < 0) continue;
      const target = (agents[started.agent] ??= freshUsage());
      target.longestToolCallMs = Math.max(target.longestToolCallMs, durationMs);
      if (
        longestToolCall === undefined ||
        durationMs / 1000 > longestToolCall.seconds
      ) {
        longestToolCall = {
          agent: started.agent,
          tool: started.tool,
          seconds: Math.round(durationMs / 1000),
        };
      }
    }
  }

  return { agents, longestToolCall };
}

async function findRuns(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.name === "summary.json")) {
      found.push(dir);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(resolve(dir, entry.name), depth + 1);
    }
  };
  await walk(root, 0);
  return found.sort();
}

async function reclassify(runDir: string, root: string): Promise<RunRecord | null> {
  let summary: Summary;
  try {
    summary = JSON.parse(
      await readFile(resolve(runDir, "summary.json"), "utf8"),
    ) as Summary;
  } catch {
    return null;
  }

  const logPath = resolve(runDir, "log", "outputlog.jsonl");
  let lines: string[] = [];
  try {
    await stat(logPath);
    lines = (await readFile(logPath, "utf8")).split("\n").filter(Boolean);
  } catch {
    // no log: fall back to whatever the summary already carries
  }

  const timeoutMinutes = Number(summary.config?.timeoutMinutes ?? 0);
  const { agents, longestToolCall } = rebuildAgents(lines, timeoutMinutes);
  // keep the recorded token/call counts, replace only the timing fields
  const merged: Record<string, AgentUsage> = { ...summary.agents };
  for (const [name, rebuilt] of Object.entries(agents)) {
    merged[name] = { ...freshUsage(), ...merged[name], ...rebuilt };
  }
  const restated: Summary = { ...summary, agents: merged };
  const failureClass = classifyFailure(restated);
  const timedOut = Object.values(merged).reduce(
    (sum, usage) => sum + usage.timedOutInvocations,
    0,
  );
  const longestToolCallMs = Object.values(merged).reduce(
    (max, usage) => Math.max(max, usage.longestToolCallMs),
    0,
  );

  return {
    run: runDir.startsWith(root) ? runDir.slice(root.length + 1) : basename(runDir),
    model: summary.model,
    outcome: summary.outcome,
    failureMode: summary.failureMode,
    durationSeconds: summary.durationSeconds,
    failureClass,
    infrastructure: isInfrastructureFailure(failureClass),
    timedOutInvocations: timedOut,
    longestToolCallSeconds: Math.round(longestToolCallMs / 1000),
    ...(longestToolCall ? { longestToolCall } : {}),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const root = resolve(
    args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_OUTPUT_ROOT,
  );

  const runDirs = await findRuns(root);
  const records: RunRecord[] = [];
  for (const dir of runDirs) {
    const record = await reclassify(dir, root);
    if (record !== null) records.push(record);
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return;
  }

  const failures = records.filter((record) => record.failureClass !== "none");
  const counts = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.failureClass] = (acc[record.failureClass] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [
    `# Run reclassification (${records.length} runs under ${root})`,
    "",
    "| Run | Model | Outcome | Class | Infra | Timed-out inv | Longest tool call |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const record of records) {
    lines.push(
      `| ${record.run} | ${record.model} | ${record.outcome} | ${
        record.failureClass
      } | ${record.infrastructure ? "yes" : "no"} | ${
        record.timedOutInvocations
      } | ${record.longestToolCallSeconds}s${
        record.longestToolCall
          ? ` (${record.longestToolCall.agent}/${record.longestToolCall.tool})`
          : ""
      } |`,
    );
  }
  lines.push(
    "",
    `Classes: ${Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `${name} ${count}`)
      .join(", ")}`,
    `Failed runs: ${failures.length}, of which infrastructure: ${
      failures.filter((record) => record.infrastructure).length
    }`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (import.meta.main) await main();
