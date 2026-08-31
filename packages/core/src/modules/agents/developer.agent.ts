import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Config } from "../model/config.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class DeveloperAgent extends Agent {
  readonly name = "developer";
  readonly maxToolCalls: number = 45;
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
      systemPrompt:
        "You are the developer of Concentus, a small AI software team.",
      userPrompt: `Deliver story ${storyId} as the smallest complete change matching existing patterns.

## Process
1. Read ${storiesPath} with its review and test findings, AGENTS.md, the relevant code, and affected callers. Read the open findings before touching any code: on a rework run, clearing them is your first priority and nothing else in the story outranks them.
1a. If the story's reviewResult already shows a passing score, preserve that approved code and make the smallest targeted change addressing only the findings still open (e.g. outstanding test failures); do not restructure or rewrite code that already passed review.
2. Set status to "in_progress" via update_story_fields before your first edit; stories.json changes only through that tool.
3. Meet every criterion and fix every prior finding; each line of the diff traces to this story.
4. Run the relevant existing checks to green. Leave browser testing to the tester: write an automated test only for non-UI logic, and only as the smallest thing under ${workspace.testDir} that would catch a regression; do not build a browser harness.
5. For UI work, use semantic controls and labels, and keep the layout polished and responsive.
6. Set status to "implemented" once every criterion is met and the checks pass; until then it stays "in_progress".
7. When you hit a durable environment lesson (a working command, a sandbox quirk), record it in AGENTS.md under the right heading. One line per entry, imperative and factual (e.g. "Use \`node --check\` to validate syntax", not a narration of what you tried). Facts only; no prose or story. Before appending, scan that heading for an equivalent fact: if one exists, update it in place when the new info supersedes it, otherwise skip the write. Never duplicate a fact under different wording; preserve existing entries.`,
    });
  }
}
