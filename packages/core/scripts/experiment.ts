import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { z } from "zod";
import { defaultConfig, type Config } from "../src/modules/models/config.model";
import type { Summary } from "../src/modules/services/summaryCollector";
import { run, slugify } from "../src/runtime/workflow";
import type { Message } from "../src/modules/models/message.model";

const coreRoot = resolve(import.meta.dirname, "..");
const configSchema = z
  .object({
    maxIteration: z.number().int().positive().optional(),
    minScore: z.number().min(0).max(100).optional(),
    maxToolCalls: z.number().int().positive().optional(),
    runTimeoutSeconds: z.number().int().positive().optional(),
  })
  .strict();
const variantSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    config: configSchema.default({}),
  })
  .strict();
const taskSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    request: z.string().min(1),
    repeat: z.number().int().min(1).max(20),
    variants: z.array(variantSchema).min(1).optional(),
  })
  .strict();
const specSchema = z
  .object({
    variants: z.array(variantSchema).min(1),
    tasks: z.array(taskSchema).min(1),
  })
  .strict()
  .refine(
    ({ tasks }) => new Set(tasks.map((task) => task.name)).size === tasks.length,
    { message: "task names must be unique", path: ["tasks"] },
  );

type Spec = z.infer<typeof specSchema>;
const workerSchema = z.object({
  request: z.string().min(1),
  config: configSchema
    .required()
    .partial({ runTimeoutSeconds: true })
    .extend({ outputDir: z.string().min(1) }),
  workspace: z.string().min(1).optional(),
});
type Trial = {
  task: Spec["tasks"][number];
  variant: Spec["variants"][number];
  run: number;
};

type Result = {
  task: string;
  request: string;
  variant: string;
  run: number;
  directory: string;
  config: Omit<Config, "outputDir">;
  success: boolean;
  error?: string;
  summary: Summary | null;
  summaryError?: string;
};

export function trialsForExperiment(spec: Spec): Trial[] {
  return spec.tasks.flatMap((task) =>
    (task.variants ?? spec.variants).flatMap((variant) =>
      Array.from({ length: task.repeat }, (_, index) => ({
        task,
        variant,
        run: index + 1,
      })),
    ),
  );
}

export function formatRunStatus(summary: Summary | null, error?: string): string {
  if (!summary) return error ?? "no summary";
  const detail = summary.error?.cause?.message ?? summary.error?.message;
  return detail ? `${summary.outcome} · ${detail}` : summary.outcome;
}

async function readSummary(
  directory?: string,
): Promise<{ summary: Summary | null; error?: string }> {
  if (!directory) return { summary: null, error: "Run directory missing" };
  try {
    const summary = JSON.parse(
      await readFile(resolve(directory, "summary.json"), "utf8"),
    ) as Summary;
    for (const agent of Object.values(summary.agents))
      delete (agent as { callLog?: unknown }).callLog;
    return { summary };
  } catch (cause) {
    return {
      summary: null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

function gitOutput(...args: string[]): string | null {
  const process = Bun.spawnSync(["git", ...args], {
    cwd: coreRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  return process.exitCode === 0 ? process.stdout.toString().trim() : null;
}

async function runExperiment(
  spec: z.infer<typeof specSchema>,
  signal: AbortSignal,
  onMessage?: (message: Message) => void,
  onStatus?: (status: string) => void,
  onElapsed?: (seconds: number) => void,
): Promise<boolean> {
  const startedAt = new Date().toISOString();
  const runsRoot = resolve(coreRoot, "runs");
  const existing = await readdir(runsRoot).catch(() => [] as string[]);
  const execution =
    existing.reduce(
      (max, name) =>
        Math.max(max, Number(/^experiment-(\d+)$/.exec(name)?.[1] ?? 0)),
      0,
    ) + 1;
  const experimentRoot = resolve(
    runsRoot,
    `experiment-${execution}`,
    slugify(spec.tasks.map((task) => task.name).join("-")),
  );
  await mkdir(experimentRoot, { recursive: true });
  const reportPath = resolve(experimentRoot, "experiment.json");
  const results: Result[] = [];

  const gitStatus = gitOutput("status", "--porcelain");
  const environment = {
    gitCommit: gitOutput("rev-parse", "HEAD"),
    gitDirty: gitStatus === null ? null : gitStatus.length > 0,
    ollamaModel: process.env.OLLAMA_MODEL ?? null,
    bunVersion: Bun.version,
  };
  const writeReport = (endedAt?: string) =>
    writeFile(
      reportPath,
      `${JSON.stringify({ startedAt, endedAt, cancelled: signal.aborted, environment, spec, results }, null, 2)}\n`,
    );
  await writeReport();

  let allSuccessful = true;
  for (const { task, variant, run: runIndex } of trialsForExperiment(spec)) {
      if (signal.aborted) break;
      const trialStartedAt = Date.now();
      const outputDir = resolve(
        experimentRoot,
        task.name,
        `${variant.name}-run-${runIndex}`,
      );
      const config: Config = {
        ...defaultConfig,
        ...variant.config,
        outputDir: outputDir as Config["outputDir"],
      };
      onStatus?.(
        `[${task.name}/${variant.name} ${runIndex}/${spec.repeat}] starting`,
      );

      let success = false;
      let error: string | undefined;
      try {
        ({ success, error } = await runTrial(
          task.request,
          config,
          outputDir,
          signal,
          onMessage,
        ));
      } catch (cause) {
        success = false;
        error = cause instanceof Error ? cause.message : String(cause);
      }

      const { summary, error: summaryError } = await readSummary(outputDir);
      results.push({
        task: task.name,
        request: task.request,
        variant: variant.name,
        run: runIndex,
        directory: relative(coreRoot, outputDir),
        config: {
          maxIteration: config.maxIteration,
          minScore: config.minScore,
          maxToolCalls: config.maxToolCalls,
          runTimeoutSeconds: config.runTimeoutSeconds,
        },
        success,
        error,
        summary,
        summaryError,
      });
      allSuccessful &&= success;
      await writeReport();
      onStatus?.(
        `[${task.name}/${variant.name} ${runIndex}/${spec.repeat}] ${formatRunStatus(summary, error)}`,
      );
      onElapsed?.(Math.floor((Date.now() - trialStartedAt) / 1000));
  }

  await writeReport(new Date().toISOString());
  onStatus?.(`Experiment report: ${reportPath}`);
  return allSuccessful && !signal.aborted;
}

/** Kill a detached child and its whole process group. */
function killTree(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

async function runTrial(
  request: string,
  config: Config,
  workspace: string,
  signal: AbortSignal,
  onMessage?: (message: Message) => void,
): Promise<{ success: boolean; error?: string }> {
  signal.throwIfAborted();
  const child = spawn(
    process.execPath,
    [import.meta.path, "--worker", JSON.stringify({ request, config, workspace })],
    { cwd: coreRoot, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  const stdout = forwardWorkerMessages(
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    onMessage,
  );
  const stderr = new Response(
    Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>,
  ).text();
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    if (forceKill) return;
    killTree(child.pid!, "SIGTERM");
    forceKill = setTimeout(() => killTree(child.pid!, "SIGKILL"), 5_000);
    forceKill.unref();
  };
  const deadline = config.runTimeoutSeconds
    ? setTimeout(terminate, config.runTimeoutSeconds * 1_000 + 5_000)
    : undefined;
  deadline?.unref();
  signal.addEventListener("abort", terminate, { once: true });
  if (signal.aborted) terminate();
  try {
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("close", (code) => resolveExit(code));
    });
    await stdout;
    const error = (await stderr).trim();
    return {
      success: exitCode === 0 && !signal.aborted,
      error: error || undefined,
    };
  } finally {
    if (deadline) clearTimeout(deadline);
    if (forceKill) clearTimeout(forceKill);
    signal.removeEventListener("abort", terminate);
  }
}

async function runWorker(serialized: string): Promise<void> {
  const payload = workerSchema.parse(JSON.parse(serialized));
  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());
  process.once("SIGTERM", () => abort.abort());
  try {
    const success = await run(
      {
        ...payload.config,
        outputDir: payload.config.outputDir as Config["outputDir"],
      },
      payload.request,
      (message) =>
        process.stdout.write(`${JSON.stringify({ type: "message", message })}\n`),
      abort.signal,
      payload.workspace as Config["outputDir"] | undefined,
    );
    if (!success) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export async function forwardWorkerMessages(
  stream: ReadableStream<Uint8Array>,
  onMessage?: (message: Message) => void,
): Promise<void> {
  if (!onMessage) return new Response(stream).text().then(() => undefined);

  const decoder = new TextDecoder();
  let pending = "";
  let pendingText: Extract<Message, { type: "text_delta" }> | undefined;
  const forward = (message: Message) => {
    if (message.type === "text_delta") {
      pendingText = pendingText
        ? { ...pendingText, delta: pendingText.delta + message.delta }
        : message;
      return;
    }
    if (message.type === "text_end" && pendingText) {
      onMessage(pendingText);
      pendingText = undefined;
    }
    onMessage(message);
  };
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line) as { type: "message"; message: Message };
      if (event.type === "message") forward(event.message);
    }
  }
  pending += decoder.decode();
  if (pending) {
    const event = JSON.parse(pending) as { type: "message"; message: Message };
    if (event.type === "message") forward(event.message);
  }
  if (pendingText) onMessage(pendingText);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--worker") {
    if (!args[1]) throw new Error("Missing experiment worker payload");
    await runWorker(args[1]);
    return;
  }
  const unknownOptions = args.filter(
    (value) => value.startsWith("--") && value !== "--dry-run",
  );
  const positional = args.filter((value) => !value.startsWith("--"));
  if (unknownOptions.length > 0 || positional.length > 1) {
    throw new Error(
      `Usage: bun run experiment [spec.json] [--dry-run]`,
    );
  }
  const argument = positional[0];
  const specPath = argument
    ? resolve(process.cwd(), argument)
    : resolve(import.meta.dirname, "f06-experiment.json");
  const spec = specSchema.parse(JSON.parse(await readFile(specPath, "utf8")));

  if (process.argv.includes("--dry-run")) {
    const variantNames = new Set(
      spec.tasks.flatMap((task) => (task.variants ?? spec.variants).map((v) => v.name)),
    );
    process.stdout.write(
      `${trialsForExperiment(spec).length} runs: ${spec.tasks.map((task) => `${task.name}(${task.repeat})`).join(", ")} × ${[...variantNames].join(", ")}\n`,
    );
    return;
  }

  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());
  process.once("SIGTERM", () => abort.abort());

  const [{ App }, { render }] = await Promise.all([
    import("../src/tui/index.tsx"),
    import("@opentui/solid"),
  ]);
  let success = false;
  await render(() =>
    App({
      initialRequest: `Run tasks: ${spec.tasks.map((task) => task.name).join(", ")}`,
      signal: abort.signal,
      run: (_request, onMessage, signal, onStatus, onElapsed) =>
        runExperiment(spec, signal, onMessage, onStatus, onElapsed).then(
          (result) => {
            success = result;
            return result;
          },
        ),
    }),
  );
  if (!success) process.exitCode = abort.signal.aborted ? 130 : 1;
}

if (import.meta.main) await main();
