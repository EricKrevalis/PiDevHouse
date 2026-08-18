import type { AgentContext } from "./agents/agent.model.ts";
import type { ModelProvider } from "./providers/modelProvider.model.ts";
import type { Workspace } from "./workspace.model.ts";

export interface WorkflowAgent {
  run(
    storyId?: number,
    iteration?: number,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface WorkflowAgentFactory {
  createProductOwner(options: {
    request: string;
    storiesPath: string;
    workspace: Workspace;
    modelProvider: ModelProvider;
    timeoutMinutes: number;
    runId: string;
    dependencies: AgentContext;
  }): WorkflowAgent;
  createGuide(options: {
    workspace: Workspace;
    modelProvider: ModelProvider;
    runId: string;
    dependencies: AgentContext;
  }): WorkflowAgent;
}
