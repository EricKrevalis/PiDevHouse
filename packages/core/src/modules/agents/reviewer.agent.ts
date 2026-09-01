import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Config } from "../model/config.model.ts";
import type { ValidationResult } from "../model/story.model.ts";
import { ModelProvider } from "../model/providers/modelProvider.model.ts";
import { Workspace } from "../model/workspace.model.ts";
import { TOOLS } from "../tools/registry.ts";

export class ReviewerAgent extends Agent {
  readonly name = "reviewer";
  readonly maxToolCalls = 45;
  readonly writeAccess = "notes" as const;
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

  private readonly storyId: number;
  private readonly minScore: number;
  private reviewResultBefore?: ValidationResult;

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
2. Verify every criterion by execution or code trace: run the checks, follow the paths. For UI work, read the markup and scripts for semantic accessibility and behaviour.
   Do not drive a browser. The tester owns browser verification and runs only after this review passes, so testResult is always empty while you are reading. That absence is the pipeline's ordering, not a defect: never record it as a finding and never let it hold down the score. Judge browser-only behaviour from the markup and scripts instead.
   Sandbox rules for any spot-check you run (see ## Sandbox): no $(...) command substitution, no bare $VAR as a command name, no > redirection to anything but /dev/null. Run each command on its own line and read its stdout directly.
3. Hunt issues the story introduced in the implementation: correctness, security, error handling, regressions, maintainability. The developer's own test file is not the review target; note only where it masks or proves a criterion outcome. Never write, edit, or debug implementation files, test files, stubs, or scripts: report the finding instead of fixing it.
4. Record reviewResult every run: concise findings with file and line references, or "No findings". One unmet criterion or open issue caps the score below ${config.minScore}; 100 means zero findings.
5. Set status to "approved" only at a passing score; otherwise leave it unchanged. Done means update_story_fields with reviewResult has been called this run; no finish without it.`,
    });
    this.storyId = storyId;
    this.minScore = config.minScore;
  }

  override async run(
    storyId?: number,
    iteration?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.reviewResultBefore = (await this.storyStore.read())?.stories.find(
      (candidate) => candidate.id === this.storyId,
    )?.reviewResult;
    return super.run(storyId, iteration, signal);
  }

  protected override async afterPrompt(session: AgentSession): Promise<void> {
    const story = (await this.storyStore.read())?.stories.find(
      (candidate) => candidate.id === this.storyId,
    );
    if (story === undefined) return;
    const before = this.reviewResultBefore;
    const wroteThisTurn =
      before === undefined ||
      story.reviewResult.score !== before.score ||
      story.reviewResult.note !== before.note;
    if (wroteThisTurn) return;
    await session
      .prompt(
        `Your turn ended without writing reviewResult for story ${this.storyId}. Call update_story_fields now with the findings you already have: concise findings with file and line references, or "No findings". One unmet criterion or open issue caps the score below ${this.minScore}; 100 means zero findings. Set status to "approved" only at a passing score.`,
      )
      .catch(() => {});
  }
}
