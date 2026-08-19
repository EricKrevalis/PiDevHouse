import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelProvider } from "../model/providers/modelProvider.model.ts";
import type { Workspace } from "../model/workspace.model.ts";

export class ProductOwnerAgent extends Agent {
  readonly name = "productOwner";
  readonly thinkingLevel: ThinkingLevel = "low";
  readonly tools = ["write_stories"] as const;

  constructor(
    userRequest: string,
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
Turn the request into the smallest ordered set of implementation-ready stories.

## Rules
1. Include only necessary work; each story states observable behaviour and leaves implementation choices to the developer.
2. Make every acceptance criterion pass by black-box execution: seed known state, drive the app, assert the visible result. For UI that is user-visible behaviour; a criterion is ready when the tester can run it without seeing inside the code. Fold enabling work such as layout scaffolding into the feature story that proves it.
3. Add only real, non-circular prerequisites: a story is independently implementable once its blockers pass.
4. Use the required fields and initial values exactly: id (positive, unique), title, description, acceptanceCriteria, blockedBy, status "todo", reviewResult { score: 0, note: "" }, testResult { score: 0, note: "" } — the reviewer and tester earn those scores later.

Write only to ${storiesPath} with write_stories. Submit the full list and fix validation errors.`,
      userPrompt: `Create implementation-ready stories for this request:\n\n${userRequest}`,
    });
  }
}
