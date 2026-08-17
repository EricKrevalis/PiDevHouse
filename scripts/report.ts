import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Summary } from "../packages/core/src/modules/model/summary.model.ts";

const OUTPUT_ROOT = resolve(import.meta.dirname ?? ".", "../output");

interface Run {
  name: string;
  summary: Summary;
}

interface Failure {
  name: string;
  outcome: string;
  reasons: string;
  unresolvedStories: string;
  error: string;
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function agentTotals(summary: Summary): { tokens: number; calls: number } {
  let tokens = 0;
  let calls = 0;
  for (const usage of Object.values(summary.agents)) {
    tokens += usage.inputTokens + usage.outputTokens;
    calls += usage.calls;
  }
  return { tokens, calls };
}

function agentTokenColumn(summary: Summary, name: string): number {
  const usage = summary.agents[name];
  return usage ? usage.inputTokens + usage.outputTokens : 0;
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

async function runDirectories(
  root: string,
  runName = "",
): Promise<string[]> {
  const entries = await readdir(resolve(root, runName), {
    withFileTypes: true,
  });
  const names = new Set(entries.map((entry) => entry.name));
  if (
    names.has("summary.json") ||
    (names.has("src") && names.has("log") && names.has("test"))
  ) {
    return [runName];
  }

  const runs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    runs.push(...(await runDirectories(root, join(runName, entry.name))));
  }
  return runs;
}

function terminalStatus(summary: Summary): string {
  if (summary.config.testerEnabled === true) return "tested";
  if (summary.config.reviewerEnabled === true) return "approved";
  return "implemented";
}

function failure(summary: Summary, name: string): Failure | undefined {
  const unresolvedStories = summary.stories
    .filter((story) => story.status !== terminalStatus(summary))
    .map((story) => `#${story.id} (${story.status})`);
  const reasons = [
    ...(summary.outcome === "completed" ? [] : [summary.outcome]),
    ...(unresolvedStories.length === 0 ? [] : ["unresolved stories"]),
  ];
  if (reasons.length === 0) return;
  return {
    name,
    outcome: summary.outcome,
    reasons: reasons.join(", "),
    unresolvedStories: unresolvedStories.join(", ") || "-",
    error: summary.error ?? "-",
  };
}

async function main(): Promise<void> {
  const csvPath = process.argv.find((arg) => arg.startsWith("--csv="))?.slice(6);
  const failuresOnly = process.argv.includes("--failures");
  const runs: Run[] = [];
  const failures: Failure[] = [];

  for (const runName of await runDirectories(OUTPUT_ROOT)) {
    try {
      const summary = JSON.parse(
        await readFile(resolve(OUTPUT_ROOT, runName, "summary.json"), "utf8"),
      ) as Summary;
      runs.push({ name: runName, summary });
      const runFailure = failure(summary, runName);
      if (runFailure) failures.push(runFailure);
    } catch (error) {
      if (failuresOnly) {
        failures.push({
          name: runName,
          outcome: "no_summary",
          reasons: "missing or unreadable summary",
          unresolvedStories: "-",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  runs.sort((a, b) => a.name.localeCompare(b.name));
  failures.sort((a, b) => a.name.localeCompare(b.name));

  if (failuresOnly) {
    console.log(`# Failures (${failures.length})`);
    if (failures.length === 0) return;
    console.log(
      markdownTable(
        ["Run", "Outcome", "Reasons", "Unresolved stories", "Error"],
        failures.map((item) => [
          item.name,
          item.outcome,
          item.reasons,
          item.unresolvedStories,
          item.error,
        ]),
      ),
    );
    return;
  }

  const runRows = runs.map(({ name, summary }) => {
    const totals = agentTotals(summary);
    const tested = summary.stories.filter((s) => s.status === "tested").length;
    return [
      name,
      summary.outcome,
      formatDuration(summary.durationSeconds),
      `${tested}/${summary.stories.length}`,
      formatTokens(totals.tokens),
      String(totals.calls),
    ];
  });

  console.log(`# Runs (${runs.length})`);
  if (runs.length === 0) {
    console.log("No runs with summary.json found under output/.");
    return;
  }
  console.log(
    markdownTable(
      ["Run", "Outcome", "Duration", "Tested", "Tokens", "Calls"],
      runRows,
    ),
  );

  const storyRows = runs.flatMap(({ name, summary }) =>
    summary.stories.map((story) => [
      name,
      `#${story.id}`,
      story.title,
      story.status,
      String(story.reviewScore),
      String(story.testScore),
      String(story.iterations),
    ])
  );
  console.log("\n## Stories");
  console.log(
    markdownTable(
      ["Run", "Story", "Title", "Status", "Review", "Test", "Iterations"],
      storyRows,
    ),
  );

  if (csvPath) {
    const header = [
      "run",
      "outcome",
      "durationSeconds",
      "request",
      "model",
      "tested",
      "total",
      "totalTokens",
      "calls",
      "poTokens",
      "developerTokens",
      "reviewerTokens",
      "testerTokens",
      "orchestratorTokens",
      "maxIterations",
      "minScore",
      "reviewerEnabled",
      "testerEnabled",
      "blockingPolicy",
      "timeoutMinutes",
      "thinkingLevel",
      "concurrency",
      "orchestratorEnabled",
    ];
    const rows = runs.map(({ name, summary }) => {
      const totals = agentTotals(summary);
      const tested = summary.stories.filter((s) =>
        s.status === "tested"
      ).length;
      return [
        name,
        summary.outcome,
        summary.durationSeconds,
        summary.request,
        summary.model,
        tested,
        summary.stories.length,
        totals.tokens,
        totals.calls,
        agentTokenColumn(summary, "productOwner"),
        agentTokenColumn(summary, "developer"),
        agentTokenColumn(summary, "reviewer"),
        agentTokenColumn(summary, "tester"),
        agentTokenColumn(summary, "orchestrator"),
        summary.config.maxIterations,
        summary.config.minScore,
        summary.config.reviewerEnabled,
        summary.config.testerEnabled,
        summary.config.blockingPolicy,
        summary.config.timeoutMinutes,
        summary.config.thinkingLevel,
        summary.config.concurrency,
        summary.config.orchestratorEnabled,
      ].join(",");
    });
    await writeFile(
      csvPath,
      `${header.join(",")}\n${rows.join("\n")}\n`,
    );
    console.log(`\nCSV written to ${csvPath}`);
  }
}

await main();
