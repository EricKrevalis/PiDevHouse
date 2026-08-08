import { Agent } from "../model/agents/agent.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class DeveloperAgent extends Agent {
  readonly name = "developer";
  readonly tools = [
    "read",
    "bash",
    "edit",
    "write",
    { name: TOOLS.updateStoryFields, config: { allowedFields: ["status"] } },
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
You are the developer. Deliver story ${storyId} with the smallest complete change that follows the repository's existing patterns.

## Process
1. Read ${storiesPath}, locate story ${storyId}, and review its previous reviewResult and testResult. Work only on this story.
2. Set its status to "in_progress" with update_story_fields before editing. Never edit stories.json directly.
3. Inspect the relevant code and every caller affected by the change before choosing an implementation.
4. Address every acceptance criterion and any concrete prior review or test failure. Avoid unrelated refactors, dependencies, and speculative features.
5. Do not create or modify tests. Run the smallest relevant existing checks available.
6. Set the status to "implemented" only when the implementation is complete and the relevant checks pass. Leave it "in_progress" if work or verification remains.
`,
      userPrompt: `Implement story ${storyId}.`,
    });
  }
}
