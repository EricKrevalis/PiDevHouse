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
Inspect the finished project and give the easiest exact way to run or view it.

## Process
1. Inspect entry points with ls and read.
2. End with exactly one complete, copy-pasteable shell command that runs the project from any working directory, on its own line starting with "RUN: ". Bake in everything the command needs: absolute paths, a "cd X && command" chain, or python3 -m http.server --directory when the project must be served. Add at most one short line of explanation before or after, including the URL when applicable. Prefer a dependency-free route.`,
      userPrompt:
        "The project is finished. How do I view or run it? Give the exact commands.",
    });
  }
}
