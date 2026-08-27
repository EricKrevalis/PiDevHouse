import { parseArgs } from "node:util";
import type { StoryStatus } from "./story.model.ts";

const DEFAULT_REQUEST = "Build an interactive web todo app.";

type FlagMap = Record<string, string | boolean | undefined>;

export interface ConfigInput {
  request?: string;
  maxIterations?: number;
  minScore?: number;
  reviewerEnabled?: boolean;
  testerEnabled?: boolean;
  timeoutMinutes?: number;
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
  ) {}

  static from(input: ConfigInput = {}): Config {
    return new Config(
      input.request?.trim() || DEFAULT_REQUEST,
      input.maxIterations ?? 3,
      input.minScore ?? 75,
      input.reviewerEnabled ?? true,
      input.testerEnabled ?? true,
      input.timeoutMinutes ?? 20,
    );
  }

  static fromArgs(args: string[]): Config {
    const { values, positionals } = parseArgs({
      args,
      options: {
        "max-iterations": { type: "string" },
        "min-score": { type: "string" },
        "timeout-minutes": { type: "string" },
        "no-reviewer": { type: "boolean" },
        "no-tester": { type: "boolean" },
      },
      allowPositionals: true,
      strict: false,
    });

    return Config.from({
      request: positionals.join(" "),
      maxIterations: flagNumber(values, "max-iterations", 4),
      minScore: flagNumber(values, "min-score", 75),
      reviewerEnabled: !flagBool(values, "no-reviewer"),
      testerEnabled: !flagBool(values, "no-tester"),
      timeoutMinutes: flagNumber(values, "timeout-minutes", 20),
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
