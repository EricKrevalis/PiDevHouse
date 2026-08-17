import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { ModelProvider } from "../model/providers/modelProvider.model.ts";
import type { Workspace } from "../model/workspace.model.ts";

export class GuideAgent extends Agent {
  readonly name = "guide";
  readonly tools = ["read", "ls"] as const;

  constructor(
    workspace: Workspace,
    modelProvider: ModelProvider,
    runId: string,
    dependencies: AgentContext,
  ) {
    super({
      runId,
      workspace,
      modelProvider,
      ...dependencies,
      systemPrompt: `## Role
Inspect the complete project and give the easiest exact way to run or view it.

## Process
1. Inspect entry points with ls and read.
2. Do not modify files, install dependencies, start servers, or run the project.
3. End with a short numbered list of exact commands from the workspace and the URL when applicable. Prefer a dependency-free route.`,
      userPrompt:
        "The project is finished. How do I view or run it? Give the exact commands.",
    });
  }
}
