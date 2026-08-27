import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AgentBacktrack,
  type BacktrackBreakdown,
  extractBacktrackFromJsonl,
} from "../src/modules/service/backtrackExtractor.ts";

// offline analysis, same category as experiment.ts: reads a finished run's
// outputlog.jsonl and prints failed tool calls / total per agent, with a
// per-tool failure breakdown. no pipeline wiring.
//
// usage:
//   bun scripts/backtrackReport.ts <run-dir | path/to/outputlog.jsonl>
// a run dir is any directory containing an outputlog.jsonl.

async function resolveLogPath(arg: string): Promise<string> {
  const target = resolve(process.cwd(), arg);
  const info = await stat(target).catch(() => null);
  if (info === null) throw new Error(`no such file or directory: ${target}`);
  return info.isDirectory() ? resolve(target, "outputlog.jsonl") : target;
}

// most-failed tool first, e.g. "bash: 83, edit: 2". "-" when nothing failed.
function formatFailuresByTool(failuresByTool: Record<string, number>): string {
  const entries = Object.entries(failuresByTool).sort(
    ([, a], [, b]) => b - a,
  );
  if (entries.length === 0) return "-";
  return entries.map(([tool, count]) => `${tool}: ${count}`).join(", ");
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function row(name: string, breakdown: BacktrackBreakdown): string {
  return [
    pad(name, 18),
    pad(String(breakdown.totalCalls), 7),
    pad(String(breakdown.failedCalls), 8),
    pad(breakdown.backtrackRate.toFixed(3), 9),
    formatFailuresByTool(breakdown.failuresByTool),
  ].join(" ");
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (arg === undefined) {
    process.stderr.write(
      "usage: bun scripts/backtrackReport.ts <run-dir | outputlog.jsonl>\n",
    );
    process.exit(1);
  }

  const logPath = await resolveLogPath(arg);
  const report = extractBacktrackFromJsonl(await readFile(logPath, "utf8"));

  const lines = [
    `\n# backtrack rate: ${logPath}\n`,
    [
      pad("agent", 18),
      pad("calls", 7),
      pad("failed", 8),
      pad("rate", 9),
      "failures by tool",
    ].join(" "),
    "-".repeat(72),
  ];
  for (const agent of report.perAgent satisfies AgentBacktrack[]) {
    lines.push(row(agent.agentName, agent));
  }
  lines.push("-".repeat(72));
  lines.push(row("ALL", report.overall));
  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
