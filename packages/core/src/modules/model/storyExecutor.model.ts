import type { AgentContext } from "./agents/agent.model.ts";
import type { Config } from "./config.model.ts";
import type { ModelProvider } from "./providers/modelProvider.model.ts";
import type { Workspace } from "./workspace.model.ts";

export interface StoryExecutor {
  run(
    storyId: number,
    workspace: Workspace,
    modelProvider: ModelProvider,
    config: Config,
    runId: string,
    dependencies: AgentContext,
    signal?: AbortSignal,
  ): Promise<void>;
}
