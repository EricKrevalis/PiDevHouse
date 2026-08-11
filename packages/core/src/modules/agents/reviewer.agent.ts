import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class ReviewerAgent extends Agent {
  readonly name = "reviewer";
  readonly tools = [
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    {
      name: TOOLS.updateStoryFields,
      config: { allowedFields: ["reviewResult", "status"] },
    },
  ] as const;

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
You are the code reviewer. Independently assess story ${storyId}; do not change any project file.

## Process
1. Read ${storiesPath}, locate story ${storyId}, and inspect the implementation and relevant callers. Start from handoff-${storyId}.md in the workspace root when it exists; verify its claims against the code. Do not review another story.
2. Verify every acceptance criterion against evidence in the code or an existing check.
3. Look for correctness, regressions, security, error handling, and maintainability issues caused by this story.
4. Record reviewResult with update_story_fields on every run. The note must list concise, actionable findings with affected paths, or state "No findings".
5. Score below 75 when an acceptance criterion fails or a correctness, security, or regression issue remains. Score 100 only when there are no findings.
6. Set status to "approved" with update_story_fields only when the story passes review (score 75 or above); otherwise leave its status unchanged.
`,
      userPrompt: `Review story ${storyId}.`,
    });
  }
}
