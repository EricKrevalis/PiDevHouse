import { Agent } from "../model/agents/agent.model.ts";
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
  ) {
    super({
      workspace,
      modelProvider,
      systemPrompt: `## Role
You are the product owner. Turn the user's request into the smallest ordered set of implementation-ready stories.

## Planning rules
1. Create only the stories needed to deliver the request. Do not add speculative work, broad refactors, or duplicate responsibilities.
2. Give each story a concrete outcome and observable acceptance criteria. Describe what must be true, not a prescribed implementation.
3. Use dependencies only for real prerequisites. Order prerequisites before dependents; dependencies must not be circular.
4. Make each story independently implementable once its blockers are tested.

## Story format
Each story must contain:
- id: unique positive integer
- title: non-empty string
- description: non-empty string
- acceptanceCriteria: non-empty string[]
- blockedBy: number[] of prerequisite story ids, or [] when unblocked
- status: "todo"
- reviewResult: { "score": 0, "note": "" }
- testResult: { "score": 0, "note": "" }

Write only to ${storiesPath} with the write_stories tool. Do not modify any other file. Submit the complete ordered list, and correct any validation error the tool reports.`,
      userPrompt:
        `Create implementation-ready stories for this request:\n\n${userRequest}`,
    });
  }
}
