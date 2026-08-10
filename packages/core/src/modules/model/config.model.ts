import { parseArgs } from "@std/cli/parse-args";
import type { StoryStatus } from "./story.model.ts";

const DEFAULT_REQUEST = "Build an interactive web todo app.";

const VALUE_FLAGS = [
  "max-iterations",
  "min-score",
  "timeout-minutes",
  "concurrency",
] as const;

const BOOLEAN_FLAGS = ["no-reviewer", "no-tester", "orchestrator"] as const;

type FlagMap = Record<string, string | boolean | undefined> & { _: string[] };

export interface ConfigInput {
  request?: string;
  maxIterations?: number;
  minScore?: number;
  reviewerEnabled?: boolean;
  testerEnabled?: boolean;
  timeoutMinutes?: number;
  concurrency?: number;
  orchestratorEnabled?: boolean;
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
    readonly concurrency: number,
    readonly orchestratorEnabled: boolean,
  ) {}

  static from(input: ConfigInput = {}): Config {
    return new Config(
      input.request?.trim() || DEFAULT_REQUEST,
      input.maxIterations ?? 3,
      input.minScore ?? 75,
      input.reviewerEnabled ?? true,
      input.testerEnabled ?? true,
      input.timeoutMinutes ?? 0,
      Number.isFinite(input.concurrency)
        ? Math.max(1, input.concurrency as number)
        : 1,
      input.orchestratorEnabled ?? false,
    );
  }

  static fromArgs(args: string[]): Config {
    const flags = parseArgs(args, {
      string: [...VALUE_FLAGS],
      boolean: [...BOOLEAN_FLAGS],
    }) as FlagMap;

    return Config.from({
      request: flags._.join(" "),
      maxIterations: flagNumber(flags, "max-iterations", 4),
      minScore: flagNumber(flags, "min-score", 75),
      reviewerEnabled: !flagBool(flags, "no-reviewer"),
      testerEnabled: !flagBool(flags, "no-tester"),
      timeoutMinutes: flagNumber(flags, "timeout-minutes", 0),
      concurrency: flagNumber(flags, "concurrency", 1),
      orchestratorEnabled: flagBool(flags, "orchestrator"),
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
      concurrency: this.concurrency,
      orchestratorEnabled: this.orchestratorEnabled,
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
