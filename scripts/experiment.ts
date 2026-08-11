import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { Summary } from "../packages/core/src/modules/model/summary.model.ts";

const MAIN_PATH = resolve(
  import.meta.dirname ?? ".",
  "../packages/core/src/main.ts",
);
const OUTPUT_ROOT = resolve(import.meta.dirname ?? ".", "../output");
const DEFAULT_REQUEST = "Build an interactive web todo app.";

async function latestRunDir(): Promise<string | null> {
  let newest: string | null = null;
  let newestMtime = 0;
  for (const group of await readdir(OUTPUT_ROOT, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of await readdir(resolve(OUTPUT_ROOT, group.name), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const mtime = (await stat(
        resolve(OUTPUT_ROOT, group.name, entry.name),
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
  const specPath = process.argv[2];
  const spec: Spec = specPath
    ? (JSON.parse(await readFile(specPath, "utf8")) as Spec)
    : {};
  const repeat = spec.repeat ?? 3;
  const variants: Variant[] = (spec.variants ?? [{}]).map((variant) => ({
    request: variant.request ?? DEFAULT_REQUEST,
    flags: buildFlags(variant.flags ?? {}),
  }));

  const results: Result[] = [];

  for (const [variantIndex, variant] of variants.entries()) {
    for (let runIndex = 1; runIndex <= repeat; runIndex++) {
      console.log(
        `=== variant ${
          variantIndex + 1
        }/${variants.length}, run ${runIndex}/${repeat} ===`,
      );
      const status = await new Promise<number>((resolveExit) => {
        const child = spawn(
          "bun",
          [MAIN_PATH, ...variant.flags, variant.request],
          { stdio: "inherit" },
        );
        child.on("exit", (code) => resolveExit(code ?? 1));
      });

      const runName = (await latestRunDir()) ?? "";
      let summary: Summary | null = null;
      try {
        summary = JSON.parse(
          await readFile(
            resolve(OUTPUT_ROOT, runName, "summary.json"),
            "utf8",
          ),
        ) as Summary;
      } catch {
      }
      results.push({
        variantIndex: variantIndex + 1,
        runIndex,
        runName,
        exitCode: status,
        summary,
      });
    }
  }

  const reportPath = resolve(OUTPUT_ROOT, `experiment-${Date.now()}.json`);
  await writeFile(
    reportPath,
    `${JSON.stringify({ spec: { repeat, variants }, results }, null, 2)}\n`,
  );

  console.log("\n# Results");
  console.log(
    "| Variant | Run | Outcome | Exit | Duration | Tested | Tokens | Calls |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
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
    console.log(
      `| ${result.variantIndex} | ${result.runIndex} | ${
        summary?.outcome ?? "no_summary"
      } | ${result.exitCode} | ${duration} | ${tested} | ${totals.tokens} | ${totals.calls} |`,
    );
  }
  console.log(`\nExperiment report: ${reportPath}`);
}

await main();
