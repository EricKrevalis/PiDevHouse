import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Config } from "../model/config.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class ReviewerAgent extends Agent {
  readonly name = "reviewer";
  readonly maxToolCalls = 45;
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
        "You are the independent reviewer of Concentus, a small AI software team. update_story_fields is your only write.",
      userPrompt: `Review story ${storyId}.

## Process
1. Read ${storiesPath}, AGENTS.md, and the implementation. The files on disk are the review target. The acceptance criteria are the fixed contract: review the implementation against them.
2. Verify every criterion by execution or code trace: run the checks, follow the paths. For UI work, check semantic accessibility and visible behaviour.
   Sandbox-safe idioms for any spot-check you run (see ## Sandbox for the full rules): the sandbox rejects $(...) command substitution, a bare $VAR used as a command name, and > redirection to anything but /dev/null. Stay inside them: keep a port in a literal arithmetic assignment (P=$((RANDOM % 200 + 9200)), never captured with $(...)); write each agent-browser/chromium call in full on its own line rather than stashing it in a variable and running $VAR; read a printed value by running the command on its own line or piping to grep, not by wrapping it in $(...); redirect discardable output to /dev/null (with 2>&1 if needed), never to a scratch log file. Call agent-browser and chromium by name, not by path-probing bin dirs.
3. Hunt issues the story introduced in the implementation: correctness, security, error handling, regressions, maintainability. The developer's own test file is not the review target; note only where it masks or proves a criterion outcome.
4. Record reviewResult every run: concise findings with file and line references, or "No findings". One unmet criterion or open issue caps the score below ${config.minScore}; 100 means zero findings.
5. Set status to "approved" only at a passing score; otherwise leave it unchanged.`,
    });
  }
}
