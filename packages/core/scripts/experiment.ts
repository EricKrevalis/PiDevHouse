import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplicationContext } from "../src/application.ts";
import { Config } from "../src/modules/model/config.model.ts";
import type { Summary } from "../src/modules/model/summary.model.ts";
import { TerminalView } from "../src/modules/ui/terminalView.tsx";

const OUTPUT_ROOT = resolve(import.meta.dirname ?? ".", "../../output");
const DEFAULT_REQUEST = "Build an interactive web todo app.";

try {
  process.loadEnvFile(resolve(import.meta.dirname ?? ".", "../../.env"));
} catch {
  // no .env file
}

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

async function latestRunDir(outputRoot: string): Promise<string | null> {
  let newest: string | null = null;
  let newestMtime = 0;
  for (const group of await readdir(outputRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of await readdir(resolve(outputRoot, group.name), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const mtime = (await stat(
        resolve(outputRoot, group.name, entry.name),
      )).mtime;
      if (mtime && mtime.getTime() > newestMtime) {
        newestMtime = mtime.getTime();
        newest = `${group.name}/${entry.name}`;
      }
    }
  }
  return newest;
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
    ? (JSON.parse(await readFile(specPath, "utf8")) as Spec)
    : {};
  const repeat = spec.repeat ?? 3;
  const variants: Variant[] = (spec.variants ?? [{}]).map((variant) => ({
    request: variant.request ?? DEFAULT_REQUEST,
    flags: buildFlags(variant.flags ?? {}),
  }));

  const results: Result[] = [];
  // ponytail: runs share one process; restore child isolation if state leaks between runs.
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
        const failed = await application.workflowService.run(
          Config.fromArgs([...variant.flags, variant.request]),
          undefined,
          terminalView.signal,
        );

        const runName = (await latestRunDir(outputRoot)) ?? "";
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

    const reportPath = resolve(outputRoot, `experiment-${Date.now()}.json`);
    await writeFile(
      reportPath,
      `${JSON.stringify({ outputSubdir: subdir, spec: { repeat, variants }, results }, null, 2)}\n`,
    );

    terminalView.write("\n# Results\n");
    terminalView.write(
      "| Variant | Run | Outcome | Exit | Duration | Tested | Tokens | Calls |",
    );
    terminalView.write("\n|---|---|---|---|---|---|---|---|\n");
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
      terminalView.write(
        `| ${result.variantIndex} | ${result.runIndex} | ${
          summary?.outcome ?? "no_summary"
        } | ${result.exitCode} | ${duration} | ${tested} | ${totals.tokens} | ${totals.calls} |`,
      );
      terminalView.write("\n");
    }
    terminalView.write(`\nExperiment report: ${reportPath}\n`);
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await terminalView.close();
  }
}

await main();
