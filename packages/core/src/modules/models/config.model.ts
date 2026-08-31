import type { Path } from "typescript";
import { resolve } from "node:path";

export interface Config {
  outputDir: Path;
  maxIteration: number;
  minScore: number;
  maxToolCalls: number;
  /** Optional hard deadline in seconds; unset means the run has no deadline. */
  runTimeoutSeconds?: number;
}

export const defaultConfig: Config = {
  outputDir: resolve("runs") as Path,
  maxIteration: 3,
  minScore: 60,
  maxToolCalls: 100,
};

export const AGENT_DIRS = ["src", "test"];
export const STORIES_FILE = "log/stories.json";
export const LOG_FILE = "log/log.jsonl";
