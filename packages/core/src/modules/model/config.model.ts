import { parseArgs } from "node:util";
import type { StoryStatus } from "./story.model.ts";

const DEFAULT_REQUEST = "Build an interactive web todo app.";

// timeoutMinutes bounds one agent invocation, nothing bounds the run above it:
// maxIterations x three agents x timeoutMinutes, once per story, is hours. two
// runs on 2026-08-31 took 2.6 and 4.1 hours that way, against a 47 minute worst
// case among the runs that finished. this ceiling stops one stuck run from
// eating an unattended batch. 0 disables it.
const DEFAULT_MAX_RUN_MINUTES = 120;

// shared by both entry points. from() said 3 while fromArgs() said 4, so every
// run started through the HTTP API silently got one iteration fewer than the
// CLI, the README and the docs promise.
const DEFAULT_MAX_ITERATIONS = 4;
const DEFAULT_MIN_SCORE = 75;
const DEFAULT_TIMEOUT_MINUTES = 20;

type FlagMap = Record<string, string | boolean | undefined>;

export interface ConfigInput {
  request?: string;
  maxIterations?: number;
  minScore?: number;
  reviewerEnabled?: boolean;
  testerEnabled?: boolean;
  timeoutMinutes?: number;
  maxRunMinutes?: number;
}

function flagBool(flags: FlagMap, name: string): boolean {
  return flags[name] === true;
}

function flagNumber(flags: FlagMap, name: string, fallback: number): number {
  const raw = flags[name];
  return typeof raw !== "string" || raw === "" ? fallback : Number(raw);
}

export class Config {
  private constructor(
    readonly request: string,
    readonly maxIterations: number,
    readonly minScore: number,
    readonly reviewerEnabled: boolean,
    readonly testerEnabled: boolean,
    readonly timeoutMinutes: number,
    readonly maxRunMinutes: number,
  ) {}

  static from(input: ConfigInput = {}): Config {
    return new Config(
      input.request?.trim() || DEFAULT_REQUEST,
      input.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      input.minScore ?? DEFAULT_MIN_SCORE,
      input.reviewerEnabled ?? true,
      input.testerEnabled ?? true,
      input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
      input.maxRunMinutes ?? DEFAULT_MAX_RUN_MINUTES,
    );
  }

  static fromArgs(args: string[]): Config {
    const { values, positionals } = parseArgs({
      args,
      options: {
        "max-iterations": { type: "string" },
        "min-score": { type: "string" },
        "timeout-minutes": { type: "string" },
        "max-run-minutes": { type: "string" },
        "no-reviewer": { type: "boolean" },
        "no-tester": { type: "boolean" },
      },
      allowPositionals: true,
      strict: false,
    });

    return Config.from({
      request: positionals.join(" "),
      maxIterations: flagNumber(
        values,
        "max-iterations",
        DEFAULT_MAX_ITERATIONS,
      ),
      minScore: flagNumber(values, "min-score", DEFAULT_MIN_SCORE),
      reviewerEnabled: !flagBool(values, "no-reviewer"),
      testerEnabled: !flagBool(values, "no-tester"),
      timeoutMinutes: flagNumber(
        values,
        "timeout-minutes",
        DEFAULT_TIMEOUT_MINUTES,
      ),
      maxRunMinutes: flagNumber(
        values,
        "max-run-minutes",
        DEFAULT_MAX_RUN_MINUTES,
      ),
    });
  }

  toJson(): Record<string, string | number | boolean> {
    return {
      request: this.request,
      maxIterations: this.maxIterations,
      minScore: this.minScore,
      reviewerEnabled: this.reviewerEnabled,
      testerEnabled: this.testerEnabled,
      timeoutMinutes: this.timeoutMinutes,
      maxRunMinutes: this.maxRunMinutes,
    };
  }

  get terminalStatus(): StoryStatus {
    return this.testerEnabled
      ? "tested"
      : this.reviewerEnabled
        ? "approved"
        : "implemented";
  }
}
