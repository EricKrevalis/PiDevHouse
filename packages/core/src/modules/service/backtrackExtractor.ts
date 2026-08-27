// reduces a run's outputlog.jsonl events into a backtrack rate per agent.
// callers parse the JSONL and hand in the log-line objects, no I/O here
// (see scripts/backtrackReport.ts). only tool_execution_end events are read.

// fields read off a parsed log line, rest optional so any parsed-JSON object fits.
export interface LogLine {
  type?: string;
  agentName?: string;
  toolName?: string;
  isError?: boolean;
}

// backtrackRate is failedCalls/totalCalls, 0 when totalCalls is 0.
// failuresByTool maps toolName to failure count.
export interface BacktrackBreakdown {
  totalCalls: number;
  failedCalls: number;
  backtrackRate: number;
  failuresByTool: Record<string, number>;
}

export interface AgentBacktrack extends BacktrackBreakdown {
  agentName: string;
}

export interface BacktrackReport {
  // every tool_execution_end across all agents, folded together.
  overall: BacktrackBreakdown;
  // one entry per agentName, sorted by name for deterministic output.
  perAgent: AgentBacktrack[];
}

const UNKNOWN_AGENT = "(unknown)";
const UNKNOWN_TOOL = "(unknown)";

function emptyBreakdown(): BacktrackBreakdown {
  return {
    totalCalls: 0,
    failedCalls: 0,
    backtrackRate: 0,
    failuresByTool: {},
  };
}

function record(breakdown: BacktrackBreakdown, line: LogLine): void {
  breakdown.totalCalls += 1;
  if (line.isError === true) {
    breakdown.failedCalls += 1;
    const tool = line.toolName ?? UNKNOWN_TOOL;
    breakdown.failuresByTool[tool] = (breakdown.failuresByTool[tool] ?? 0) + 1;
  }
}

function finalize(breakdown: BacktrackBreakdown): void {
  breakdown.backtrackRate =
    breakdown.totalCalls === 0
      ? 0
      : breakdown.failedCalls / breakdown.totalCalls;
}

export function extractBacktrack(lines: LogLine[]): BacktrackReport {
  const overall = emptyBreakdown();
  const byAgent = new Map<string, BacktrackBreakdown>();

  for (const line of lines) {
    if (line.type !== "tool_execution_end") continue;
    record(overall, line);
    const agent = line.agentName ?? UNKNOWN_AGENT;
    let breakdown = byAgent.get(agent);
    if (breakdown === undefined) {
      breakdown = emptyBreakdown();
      byAgent.set(agent, breakdown);
    }
    record(breakdown, line);
  }

  finalize(overall);
  const perAgent: AgentBacktrack[] = [...byAgent.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([agentName, breakdown]) => {
      finalize(breakdown);
      return { agentName, ...breakdown };
    });

  return { overall, perAgent };
}

// for callers holding raw JSONL text. skips blank lines; throws with the line
// number on bad JSON so a truncated log is obvious.
export function extractBacktrackFromJsonl(jsonl: string): BacktrackReport {
  const lines: LogLine[] = [];
  const rows = jsonl.split("\n");
  for (const [index, row] of rows.entries()) {
    const trimmed = row.trim();
    if (trimmed === "") continue;
    try {
      lines.push(JSON.parse(trimmed) as LogLine);
    } catch (error) {
      throw new Error(
        `outputlog.jsonl line ${index + 1} is not valid JSON: ${
          (error as Error).message
        }`,
      );
    }
  }
  return extractBacktrack(lines);
}
