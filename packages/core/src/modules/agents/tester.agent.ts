import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Config } from "../model/config.model.ts";
import type { ValidationResult } from "../model/story.model.ts";
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
  private testResultBefore?: ValidationResult;

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
1. Read ${storiesPath}, AGENTS.md, and the implementation. The files on disk are the test target.
2. Run the smallest relevant existing checks. Run tests from the test dir with relative paths, not an absolute cd to the run root: cd ${workspace.testDir} && node <file>.test.js (a test that imports ../src works fine with relative paths).
3. Browser UI: serve the app over HTTP, then drive it with agent-browser. file:// URLs are rejected, so the server is required. agent-browser launches and manages its own headless Chromium: never launch chromium yourself, never pass --cdp, never allocate a debugging port. A --session name keeps one browser alive across separate bash calls, so run these as ordinary separate commands rather than one compound line:
   cd ${workspace.testDir} && python3 -m http.server 8901 >/dev/null 2>&1 &
   agent-browser --session s${storyId} open http://localhost:8901/index.html
   agent-browser --session s${storyId} snapshot -i
   agent-browser --session s${storyId} click @e1
   agent-browser --session s${storyId} get text '#display'
   agent-browser --session s${storyId} screenshot --full ${workspace.testDir}/story-${storyId}.png
   agent-browser --session s${storyId} close
   Use the app's own server command instead of http.server when it has one, and any free port. The first snapshot must show your app; anything else means a wrong URL, so correct the URL rather than testing the wrong page. snapshot -i lists interactive elements as [ref=eN]: click them as @eN, or pass a CSS selector. Confirm each action's observable outcome with get text. Always finish with close, then stop the server: pkill -f "[h]ttp.server 8901" (the bracket keeps the pattern from matching your own command and killing the shell).
   Sandbox rules (see ## Sandbox): no $(...) command substitution, no bare $VAR as a command name, no > redirection to anything but /dev/null. None of the commands above need any of those.
4. Record testResult via update_story_fields every run; completion requires this write. Include checks, outcomes, and any failed or unverifiable criterion. Score -1 (unverifiable) for a criterion you could not execute, below ${config.minScore} when a criterion fails, and 100 only when every criterion passed by direct execution. Static inspection supports the report; execution decides the score.
5. Set status to "tested" only when every criterion passed; otherwise leave status unchanged. Done means update_story_fields with testResult has been called this run; no finish without it.
6. When you hit a durable environment lesson (a working recipe, a sandbox quirk, a command that saves the next agent time), record it in AGENTS.md under the right heading. One line per entry, imperative and factual (e.g. "Use \`agent-browser --session <name> snapshot -i\` before locating elements", not a narration of what you tried). Facts only; no prose or story. Before appending, scan that heading for an equivalent fact: if one exists, update it in place when the new info supersedes it, otherwise skip the write. Never duplicate a fact under different wording; preserve existing entries.`,
    });
    this.storyId = storyId;
    this.minScore = config.minScore;
  }

  override async run(
    storyId?: number,
    iteration?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.testResultBefore = (await this.storyStore.read())?.stories.find(
      (candidate) => candidate.id === this.storyId,
    )?.testResult;
    return super.run(storyId, iteration, signal);
  }

  protected override async afterPrompt(session: AgentSession): Promise<void> {
    const story = (await this.storyStore.read())?.stories.find(
      (candidate) => candidate.id === this.storyId,
    );
    if (story === undefined) return;
    const before = this.testResultBefore;
    const wroteThisTurn =
      before === undefined ||
      story.testResult.score !== before.score ||
      story.testResult.note !== before.note;
    if (wroteThisTurn) return;
    await session
      .prompt(
        `Your turn ended without writing testResult for story ${this.storyId}. Call update_story_fields now with the outcome of the checks you already ran: score ${this.minScore} or above only when every criterion passed by direct execution, below ${this.minScore} for failed criteria, -1 for unverifiable criteria. Set status to "tested" only when everything passed.`,
      )
      .catch(() => {});
  }
}
