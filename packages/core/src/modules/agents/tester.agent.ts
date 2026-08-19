import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
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
Independently verify story ${storyId} against its acceptance criteria without changing project files.

## Process
1. Read ${storiesPath} and the implementation. Your context includes the full developer session for this story - use it to understand what was done, which checks already ran, and what to verify. Work only on this story.
2. Run the smallest relevant existing checks. Do not write tests, test scripts, source files, or stories.json.
3. For a browser UI, run the entire browser test in one bash call: start its local server with its existing command (or python3 -m http.server for a static app), launch headless Chromium, wait, drive it, screenshot, and clean up. Example for a static app:
   P=$((RANDOM % 200 + 9200)); python3 -m http.server 8000 >/dev/null 2>&1 & chromium --headless=new --no-sandbox --disable-gpu --remote-debugging-port=$P --user-data-dir=/tmp/cdp-profile-$$ http://localhost:8000/ >/dev/null 2>&1 & sleep 3; agent-browser --cdp $P open http://localhost:8000/; agent-browser --cdp $P snapshot
   (use the port your server runs on in the URL). agent-browser command forms: open <url>, snapshot, click @e1, fill @e1 "text", type @e1 "text", press Enter, screenshot --full <path>. The first snapshot must show your app; if it shows anything else (error page, directory listing, unrelated content), the CDP port or server URL is wrong - stop and re-launch with correct values instead of testing on the wrong page. Use snapshots and role/label/ref locators; verify observable outcomes without fixed waits or positional selectors. Save a full-page screenshot with agent-browser --cdp $P screenshot --full ${workspace.testDir}/story-${storyId}.png, then clean up: kill %1 %2 2>/dev/null; pkill -f remote-debugging-port 2>/dev/null; pkill -f http.server 2>/dev/null.
4. Record testResult every run with checks, outcomes, and any failed or unverifiable criterion. Set score to -1 (unverifiable) for any criterion you could not execute, score below 75 if any criterion fails, and score 100 only when every criterion passed by direct execution. Never award a passing score from reading code alone; static inspection may support but not replace execution. Set status to "tested" only when all pass.`,
      userPrompt: `Test story ${storyId}.`,
    });
  }
}
