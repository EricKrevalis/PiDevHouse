import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Config } from "../model/config.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class TesterAgent extends Agent {
  readonly name = "tester";
  readonly maxToolCalls = 60;
  readonly writeAccess = "notes" as const;
  readonly tools = [
    "read",
    "bash",
    "edit",
    {
      name: TOOLS.updateStoryFields,
      config: { allowedFields: ["status", "testResult"] },
    },
  ] as const;

  private readonly storyId: number;
  private readonly minScore: number;

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
        "You are the independent tester of Concentus, a small AI software team.",
      userPrompt: `Test story ${storyId} against its acceptance criteria. Your writes: the screenshot, AGENTS.md, and update_story_fields.

## Process
1. Read ${storiesPath}, AGENTS.md, and the implementation. The developer session in your context is background — the files on disk are the test target.
2. Run the smallest relevant existing checks.
3. Browser UI: clear leftovers first (pkill -f http.server; pkill -f remote-debugging-port; pkill -f agent-browser), then run the whole check in one bash call: start the local server with its existing command (or python3 -m http.server for a static app), launch headless Chromium, drive it via agent-browser, screenshot, clean up. Load the command reference before any agent-browser call so the workflow is current: \`agent-browser skills get core --full\`; follow its snapshot-and-ref flow. Working pattern for a static app:
   P=$((RANDOM % 200 + 9200)); python3 -m http.server 8000 >/dev/null 2>&1 & chromium --headless=new --no-sandbox --disable-gpu --remote-debugging-port=$P --user-data-dir=/tmp/cdp-profile-$$ http://localhost:8000/ >/dev/null 2>&1 & sleep 3; agent-browser --cdp $P open http://localhost:8000/; agent-browser --cdp $P snapshot
   (use the port your server runs on in the URL). The first snapshot must show your app; anything else means wrong CDP port or server URL — relaunch with correct values rather than testing the wrong page. Locate elements by role, label, or ref from snapshots and verify each action's observable outcome. Save the full-page screenshot with agent-browser --cdp $P screenshot --full ${workspace.testDir}/story-${storyId}.png, then clean up: kill %1 %2 2>/dev/null; pkill -f remote-debugging-port 2>/dev/null; pkill -f http.server 2>/dev/null.
4. Record testResult via update_story_fields every run — completion requires this write. Include checks, outcomes, and any failed or unverifiable criterion. Score -1 (unverifiable) for a criterion you could not execute, below ${config.minScore} when a criterion fails, and 100 only when every criterion passed by direct execution. Static inspection supports the report; execution decides the score.
5. Set status to "tested" only when every criterion passed; otherwise leave status unchanged. Done means update_story_fields with testResult has been called this run — no finish without it.
6. When you hit a durable environment lesson — a working recipe, a sandbox quirk, a command that saves the next agent time — append it to AGENTS.md under the right heading. Facts only; keep it short; preserve existing entries.`,
    });
    this.storyId = storyId;
    this.minScore = config.minScore;
  }

  protected override async afterPrompt(session: AgentSession): Promise<void> {
    const story = (await this.storyStore.read())?.stories.find(
      (candidate) => candidate.id === this.storyId,
    );
    if (story === undefined || story.testResult.score >= 0) return;
    await session
      .prompt(
        `Your turn ended without writing testResult for story ${this.storyId}. Call update_story_fields now with the outcome of the checks you already ran: score ${this.minScore} or above only when every criterion passed by direct execution, below ${this.minScore} for failed criteria, -1 for unverifiable criteria. Set status to "tested" only when everything passed.`,
      )
      .catch(() => {});
  }
}
