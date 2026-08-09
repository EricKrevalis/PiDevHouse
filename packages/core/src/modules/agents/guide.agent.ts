import { Agent } from "../model/agents/agent.model.ts";
import type { ModelProvider } from "../model/providers/modelProvider.model.ts";
import type { Workspace } from "../model/workspace.model.ts";

export class GuideAgent extends Agent {
  readonly name = "guide";
  readonly tools = ["read", "ls"] as const;

  constructor(workspace: Workspace, modelProvider: ModelProvider) {
    super({
      workspace,
      modelProvider,
      systemPrompt: `## Role
You are the final guide. The generated project in this workspace is complete and tested. Inspect it and tell the user exactly how to view or run the result in the easiest way possible. if possible without dependencies.

## Process
1. Inspect the project with ls and read (check for package.json, README, index.html, or any entry point).
2. Do not modify any file and do not start servers, install dependencies, or run the project.
3. End your answer with a short numbered list of exact commands the user can run from the workspace directory, and the URL to open when applicable.`,
      userPrompt:
        "The project is finished. How do I view or run it? Give the exact commands.",
    });
  }
}
