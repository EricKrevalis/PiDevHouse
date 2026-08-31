import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplicationContext } from "../src/application.ts";
import { Config } from "../src/modules/model/config.model.ts";
import type { Summary } from "../src/modules/model/summary.model.ts";
import {
  aggregateExperimentResults,
  type Stat,
} from "../src/modules/service/experimentAggregator.ts";
import { TerminalView } from "../src/modules/ui/terminalView.tsx";

const REPOSITORY_ROOT = resolve(import.meta.dirname ?? ".", "../../..");
const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, "output");
const DEFAULT_REQUEST = "Build an interactive web todo app.";

function outputSubdir(): string | undefined {
  const flag = process.argv.find((arg) =>
    arg.startsWith("--output-subdir"),
  );
  if (flag === undefined) return;
  if (!flag.startsWith("--output-subdir=")) {
    throw new Error("Use --output-subdir=<name>");
  }
  const subdir = flag.slice("--output-subdir=".length);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(subdir)) {
    throw new Error("--output-subdir must be a single directory name");
  }
  return subdir;
}

async function experimentOutput(): Promise<{
  root: string;
  subdir: string;
}> {
  const requestedSubdir = outputSubdir();
  if (requestedSubdir !== undefined) {
    const root = resolve(OUTPUT_ROOT, requestedSubdir);
    await mkdir(root, { recursive: true });
    return { root, subdir: requestedSubdir };
  }

  await mkdir(OUTPUT_ROOT, { recursive: true });
  for (let number = 1; ; number++) {
    const subdir = `experiments-${number}`;
    const root = resolve(OUTPUT_ROOT, subdir);
    try {
      await mkdir(root);
      return { root, subdir };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }
      throw error;
    }
  }
}

async function runDir(
  outputRoot: string,
  runId: string,
): Promise<string | null> {
  try {
    for (const group of await readdir(outputRoot, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      for (const entry of await readdir(resolve(outputRoot, group.name), {
        withFileTypes: true,
      })) {
        if (
          entry.isDirectory() &&
          entry.name.endsWith(`-${runId.slice(0, 8)}`)
        ) {
          return `${group.name}/${entry.name}`;
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return null;
}

interface VariantSpec {
  request?: string;
  flags?: Record<string, string | number | boolean>;
}

interface Spec {
  repeat?: number;
  variants?: VariantSpec[];
}

interface Variant {
  request: string;
  flags: string[];
}

interface Result {
  variantIndex: number;
  runIndex: number;
  runName: string;
  exitCode: number;
  summary: Summary | null;
}

function buildFlags(
  flags: Record<string, string | number | boolean>,
): string[] {
  return Object.entries(flags).map(([name, value]) => {
    if (typeof value === "boolean") {
      return value ? `--${name}` : `--no-${name}`;
    }
    return `--${name}=${value}`;
  });
}

async function main(): Promise<void> {
  const { root: outputRoot, subdir } = await experimentOutput();
  process.env.PIDEV_OUTPUT_SUBDIR = subdir;

  const specPath = process.argv
    .slice(2)
    .find((arg) => !arg.startsWith("--"));
  const spec: Spec = specPath
    ? (JSON.parse(
        await readFile(
          resolve(REPOSITORY_ROOT, specPath),
          "utf8",
        ),
      ) as Spec)
    : {};
  const repeat = spec.repeat ?? 3;
  const variants: Variant[] = (spec.variants ?? [{}]).map((variant) => ({
    request: variant.request ?? DEFAULT_REQUEST,
    flags: buildFlags(variant.flags ?? {}),
  }));

  const results: Result[] = [];
  const application = createApplicationContext();
  const terminalView = await TerminalView.create({
    eventBus: application.eventBus,
  });
  let cancelled = false;
  const cancel = (): void => {
    cancelled = true;
    terminalView.cancel();
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let reportOutput: string | undefined;

  try {
    for (const [variantIndex, variant] of variants.entries()) {
      for (let runIndex = 1; runIndex <= repeat; runIndex++) {
        if (cancelled) break;
        terminalView.write(
          `\n=== variant ${
            variantIndex + 1
          }/${variants.length}, run ${runIndex}/${repeat} ===\n`,
          "yellow",
        );
        const runId = crypto.randomUUID();
        const failed = await application.workflowService.run(
          Config.fromArgs([...variant.flags, variant.request]),
          runId,
          terminalView.signal,
        );

        const runName = (await runDir(outputRoot, runId)) ?? "";
        let summary: Summary | null = null;
        try {
          summary = JSON.parse(
            await readFile(
              resolve(outputRoot, runName, "summary.json"),
              "utf8",
            ),
          ) as Summary;
        } catch {
        }
        results.push({
          variantIndex: variantIndex + 1,
          runIndex,
          runName,
          exitCode: failed ? 1 : 0,
          summary,
        });
      }
      if (cancelled) break;
    }

    const aggregates = aggregateExperimentResults(results);

    const reportPath = resolve(outputRoot, `experiment-${Date.now()}.json`);
    await writeFile(
      reportPath,
      `${JSON.stringify({ outputSubdir: subdir, spec: { repeat, variants }, results, aggregates }, null, 2)}\n`,
    );

    const reportLines = [
      "\n# Results\n",
      "| Variant | Run | Outcome | Exit | Duration | Tested | Tokens | Calls |",
      "|---|---|---|---|---|---|---|---|",
    ];
    for (const result of results) {
      const summary = result.summary;
      const totals = summary
        ? Object.values(summary.agents).reduce(
          (acc, usage) => ({
            tokens: acc.tokens + usage.inputTokens + usage.outputTokens,
            calls: acc.calls + usage.calls,
          }),
          { tokens: 0, calls: 0 },
        )
        : { tokens: 0, calls: 0 };
      const tested = summary
        ? `${
          summary.stories.filter((s) => s.status === "tested").length
        }/${summary.stories.length}`
        : "-";
      const duration = summary ? `${summary.durationSeconds}s` : "-";
      reportLines.push(
        `| ${result.variantIndex} | ${result.runIndex} | ${
          summary?.outcome ?? "no_summary"
        } | ${result.exitCode} | ${duration} | ${tested} | ${totals.tokens} | ${totals.calls} |`,
      );
    }
    const cell = (value: number | null, digits = 1): string =>
      value === null ? "-" : value.toFixed(digits);
    const stat = (s: Stat, digits = 1): string =>
      `${cell(s.mean, digits)}±${cell(s.stddev, digits)}`;
    reportLines.push(
      "\n## Aggregates (per variant, across repeat runs)\n",
      "Duration, tokens and calls cover valid runs only (infrastructure failures excluded).\n",
      "| Variant | Runs | Valid | Model fail | Infra fail | Duration | Tokens | Calls | Dur/inv | Calls/story | Tested |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const aggregate of aggregates) {
      reportLines.push(
        `| ${aggregate.variantIndex} | ${aggregate.runCount} | ${
          aggregate.validRunCount
        } | ${aggregate.modelFailureRate.toFixed(2)} | ${
          aggregate.infraFailureRate.toFixed(2)
        } | ${stat(aggregate.durationSeconds)}s | ${
          stat(aggregate.totalTokens, 0)
        } | ${stat(aggregate.totalCalls)} | ${
          stat(aggregate.durationPerInvocationMs, 0)
        }ms | ${
          aggregate.callsPerStory.toFixed(2)
        } | ${aggregate.testedStoryRatio.toFixed(2)} |`,
      );
    }
    const classTotals = aggregates.reduce<Record<string, number>>(
      (counts, aggregate) => {
        for (const [name, count] of Object.entries(aggregate.failureClasses)) {
          counts[name] = (counts[name] ?? 0) + count;
        }
        return counts;
      },
      {},
    );
    if (Object.keys(classTotals).length > 0) {
      reportLines.push(
        `\nFailure classes: ${Object.entries(classTotals)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, count]) => `${name} ${count}`)
          .join(", ")}`,
      );
    }
    reportLines.push(`\nExperiment report: ${reportPath}`);
    reportOutput = `${reportLines.join("\n")}\n`;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await terminalView.close();
  }
  if (reportOutput !== undefined) process.stdout.write(reportOutput);
}

await main();
