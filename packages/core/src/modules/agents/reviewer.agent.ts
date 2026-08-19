import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
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
    sessionManager?: SessionManager,
  ) {
    super({
      runId,
      workspace,
      modelProvider,
      ...dependencies,
      timeoutMinutes,
      sessionManager,
      systemPrompt: `## Role
Independently review story ${storyId}; do not change project files.

## Process
1. Read ${storiesPath}, the prior developer work, and the implementation. Your context includes the full developer session for this story - use it to understand what was done and what remains open. Work only on this story.
2. Verify each criterion with code, tests, or other evidence. For UI work, check semantic accessibility and visible behaviour.
3. Find correctness, security, error-handling, regression, and maintainability issues introduced by the story.
4. Record reviewResult every run: concise path-specific findings or "No findings". Score below 75 for an unmet criterion or remaining issue; score 100 only with no findings.
5. Set status to "approved" only with a passing score; otherwise leave it unchanged.`,
      userPrompt: `Review story ${storyId}.`,
    });
  }
}
