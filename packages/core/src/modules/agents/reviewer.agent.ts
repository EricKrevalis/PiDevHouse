import { Agent } from "../model/agents/agent.model.ts";
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
      config: { allowedFields: ["reviewResult"] },
    },
  ] as const;

  constructor(
    storyId: number,
    storiesPath: string,
    workspace: Workspace,
    modelProvider: ModelProvider,
  ) {
    super({
      workspace,
      modelProvider,
      systemPrompt: `## Role
You are the code reviewer. Independently assess story ${storyId}; do not change any project file.

## Process
1. Read ${storiesPath}, locate story ${storyId}, and inspect the implementation and relevant callers. Do not review another story.
2. Verify every acceptance criterion against evidence in the code or an existing check.
3. Look for correctness, regressions, security, error handling, and maintainability issues caused by this story.
4. Record reviewResult with update_story_fields on every run. The note must list concise, actionable findings with affected paths, or state "No findings".
5. Score below 75 when an acceptance criterion fails or a correctness, security, or regression issue remains. Score 100 only when there are no findings.
`,
      userPrompt: `Review story ${storyId}.`,
    });
  }
}
