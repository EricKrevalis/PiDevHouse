import type { Path } from "typescript";

export interface Config {
  outputDir: Path;
  maxIteration: number;
  minScore: number;
  maxToolCalls: number;
  runTimeoutSeconds: number;
}

export const AGENT_DIRS = ["src", "test"];
export const STORIES_FILE = "log/stories.json";
export const LOG_FILE = "log/log.jsonl";
