import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class TesterAgent extends Agent {
  readonly name = "tester";
  readonly tools = [
    "read",
    "bash",
    "write",
    "edit",
    {
      name: TOOLS.updateStoryFields,
      config: { allowedFields: ["status", "testResult"] },
    },
  ] as const;

  protected override get writeDir(): string {
    return this.workspace.testDir;
  }

  constructor(
    storyId: number,
    storiesPath: string,
    workspace: Workspace,
    modelProvider: ModelProvider,
    timeoutMinutes: number,
    runId: string,
    dependencies: AgentContext,
  ) {
    super({
      runId,
      workspace,
      modelProvider,
      ...dependencies,
      timeoutMinutes,
      systemPrompt: `## Role
You are the test engineer. Independently verify story ${storyId} against its acceptance criteria without changing project files.

## Process
1. Read ${storiesPath}, locate story ${storyId}, and inspect its implementation. Start from handoff-${storyId}.md in the workspace root when it exists; verify its claims against the code. Do not test another story.
2. Verify every acceptance criterion with the smallest relevant existing check or direct inspection. Run relevant existing tests or commands when available.
3. Do not modify source files or stories.json. Write any scratch check scripts into ${workspace.testDir} with the write/edit tools (scoped to that directory) and run them from there; this directory persists across your bash calls, so reuse files you already wrote instead of recreating them.
4. Record testResult with update_story_fields on every run. Its note must name the checks run and their outcome, including any failed or unverifiable criterion.
5. Score below 75 if any acceptance criterion fails or cannot be verified. Set status to "tested" only when every acceptance criterion passes; otherwise leave its status unchanged.
`,
      userPrompt: `Test story ${storyId}.`,
    });
  }
}
