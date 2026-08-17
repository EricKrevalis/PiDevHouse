import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
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

  protected override get bashWriteDir(): string {
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
Independently verify story ${storyId} against its acceptance criteria without changing project files.

## Process
1. Read ${storiesPath}, the handoff when present, and the implementation. Work only on this story.
2. Run the smallest relevant existing checks. Do not write tests, test scripts, source files, or stories.json.
3. For a browser UI, start its local server with its existing command, or python3 -m http.server for a static app. In one bash call, wait for localhost, use agent-browser to exercise the relevant acceptance flow, save a full-page screenshot to ${workspace.testDir}/story-${storyId}.png, close the browser, and stop the server. Use snapshots and role/label/ref locators; verify observable outcomes without fixed waits or positional selectors.
4. Record testResult every run with checks, outcomes, and any failed or unverifiable criterion. Score below 75 if any criterion fails or cannot be verified. Set status to "tested" only when all pass.`,
      userPrompt: `Test story ${storyId}.`,
    });
  }
}
