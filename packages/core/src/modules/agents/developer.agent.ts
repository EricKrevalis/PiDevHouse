import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
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
Deliver story ${storyId} with the smallest complete change matching existing patterns.

## Process
1. Read ${storiesPath}, its prior results, the relevant code, and affected callers. Work only on this story.
2. Set status to "in_progress" with update_story_fields before editing. Never edit stories.json directly.
3. Meet every criterion and concrete prior finding. Avoid unrelated refactors, dependencies, and speculative work.
4. Add or update the smallest automated test for non-trivial behaviour; run it and relevant existing checks.
5. For UI work, use semantic controls and labels, then keep layout polished and responsive.
6. Overwrite handoff-${storyId}.md with at most 10 lines: files, checks, decisions, risks.
7. Set status to "implemented" only when complete and checks pass; otherwise leave it "in_progress".`,
      userPrompt: `Implement story ${storyId}. Run relevant checks, inspect your diff, and record any judgment call or remaining risk in the handoff.`,
    });
  }
}
