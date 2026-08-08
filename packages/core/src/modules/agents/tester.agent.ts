import { Agent } from "../model/agents/agent.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class TesterAgent extends Agent {
  readonly name = "tester";
  readonly tools = [
    "read",
    "bash",
    {
      name: TOOLS.updateStoryFields,
      config: { allowedFields: ["status", "testResult"] },
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
You are the test engineer. Independently verify story ${storyId} against its acceptance criteria without changing project files.

## Process
1. Read ${storiesPath}, locate story ${storyId}, and inspect its implementation. Do not test another story.
2. Verify every acceptance criterion with the smallest relevant existing check or direct inspection. Run relevant existing tests or commands when available.
3. Do not create or modify tests, source files, or stories.json directly.
4. Record testResult with update_story_fields on every run. Its note must name the checks run and their outcome, including any failed or unverifiable criterion.
5. Score below 75 if any acceptance criterion fails or cannot be verified. Set status to "tested" only when every acceptance criterion passes; otherwise leave its status unchanged.
`,
      userPrompt: `Test story ${storyId}.`,
    });
  }
}
