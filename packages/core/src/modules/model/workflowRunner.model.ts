import type { Config } from "./config.model.ts";

export interface WorkflowRunner {
  run(config: Config, runId: string, signal?: AbortSignal): Promise<boolean>;
}
