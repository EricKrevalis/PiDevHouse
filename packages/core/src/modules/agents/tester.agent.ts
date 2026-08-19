import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Config } from "../model/config.model.ts";
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
Independently verify story ${storyId} against its acceptance criteria. Your writes: the screenshot and update_story_fields.

## Process
1. Read ${storiesPath} and the implementation. The developer session in your context is background — the files on disk are the test target.
2. Run the smallest relevant existing checks.
3. For a browser UI, run the whole browser test in one bash call: start its local server with its existing command (or python3 -m http.server for a static app), launch headless Chromium, wait, drive it, screenshot, and clean up. First load the official command reference so it never goes stale: \`agent-browser skills get core --full\`, then follow its snapshot-and-ref workflow. Example for a static app:
   P=$((RANDOM % 200 + 9200)); python3 -m http.server 8000 >/dev/null 2>&1 & chromium --headless=new --no-sandbox --disable-gpu --remote-debugging-port=$P --user-data-dir=/tmp/cdp-profile-$$ http://localhost:8000/ >/dev/null 2>&1 & sleep 3; agent-browser --cdp $P open http://localhost:8000/; agent-browser --cdp $P snapshot
   (use the port your server runs on in the URL). The first snapshot must show your app; anything else means the CDP port or server URL is wrong — relaunch with correct values instead of testing on the wrong page. Locate elements by role, label, or ref from snapshots and verify the observable outcome of each action. Save a full-page screenshot with agent-browser --cdp $P screenshot --full ${workspace.testDir}/story-${storyId}.png, then clean up: kill %1 %2 2>/dev/null; pkill -f remote-debugging-port 2>/dev/null; pkill -f http.server 2>/dev/null.
4. Record testResult every run: checks, outcomes, and any failed or unverifiable criterion. Score -1 (unverifiable) for a criterion you could not execute, below ${config.minScore} when a criterion fails, and 100 only when every criterion passed by direct execution. Static inspection supports the report; execution decides the score.
5. Set status to "tested" only when every criterion passed.`,
      userPrompt: `Test story ${storyId}.`,
    });
  }
}
