import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Config } from "../model/config.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class DeveloperAgent extends Agent {
  readonly name = "developer";
  readonly maxToolCalls: number = 60;
  readonly tools = [
    "read",
    "bash",
    "edit",
    "write",
    { name: TOOLS.updateStoryFields, config: { allowedFields: ["status"] } },
  ] as const;

  private readonly resumePrompt: string;

  constructor(
    storyId: number,
    storiesPath: string,
    workspace: Workspace,
    modelProvider: ModelProvider,
    config: Config,
    runId: string,
    dependencies: AgentContext,
    sessionManager?: SessionManager,
  ) {
    super({
      runId,
      workspace,
      modelProvider,
      ...dependencies,
      timeoutMinutes: config.timeoutMinutes,
      sessionManager,
      systemPrompt: `## Role
Deliver story ${storyId} as the smallest complete change matching existing patterns.

## Process
1. Read ${storiesPath} with its review and test findings, the relevant code, and affected callers.
2. Set status to "in_progress" via update_story_fields before your first edit; stories.json changes only through that tool.
3. Meet every criterion and fix every prior finding; each line of the diff traces to this story.
4. Run the relevant existing checks to green. Leave browser testing to the tester: write an automated test only for non-UI logic, and only as the smallest thing under ${workspace.testDir} that would catch a regression; do not build a browser harness.
5. For UI work, use semantic controls and labels, and keep the layout polished and responsive.
6. Set status to "implemented" once every criterion is met and the checks pass; until then it stays "in_progress".`,
      userPrompt: `Implement story ${storyId}.`,
    });
    this.resumePrompt = `Continue story ${storyId} from where the last attempt stopped. New reviewer and tester findings are recorded in ${storiesPath}: read them first and fix every open one, then re-run the checks.`;
  }

  protected override userPromptFor(iteration?: number): string {
    return iteration !== undefined && iteration > 1
      ? this.resumePrompt
      : this.userPrompt;
  }
}
