import { Agent, type AgentContext } from "../model/agents/agent.model.ts";
import type { ModelProvider } from "../model/providers/modelProvider.model.ts";
import type { Workspace } from "../model/workspace.model.ts";

export class ProductOwnerAgent extends Agent {
  readonly name = "productOwner";
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
1. Include only necessary work. Do not prescribe an implementation.
2. Give each story a concrete outcome and observable acceptance criteria that can be verified by executing the app; UI stories need user-visible behaviour. Merge untestable steps (e.g. layout scaffolding of a single-file app) into feature stories — never create a story whose criteria cannot be executed and observed.
3. Add only real, non-circular prerequisites. A story must be independently implementable once its blockers pass.
4. Use the required fields and initial values exactly: id (positive, unique), title, description, acceptanceCriteria, blockedBy, status "todo", reviewResult { score: 0, note: "" }, testResult { score: 0, note: "" }.

Write only to ${storiesPath} with write_stories. Submit the full list and fix validation errors.`,
      userPrompt: `Create implementation-ready stories for this request:\n\n${userRequest}`,
    });
  }
}
