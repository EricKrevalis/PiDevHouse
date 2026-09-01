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
      systemPrompt:
        "You are the product owner of Concentus, a small AI software team.",
      userPrompt: `Turn the request below into the smallest ordered set of implementation-ready stories.

## Rules
1. Include only necessary work; each story states observable behaviour and leaves implementation choices to the developer. A story is a feature slice, not a code branch: group variations of one behaviour (each arithmetic operator, each field's validation, each CRUD verb on a resource) into one story as separate acceptance criteria, unless a variation ships independently or has distinct business value. Prefer the fewest stories that each stay reviewable and testable as one coherent unit; don't split per operator, a small app is typically a handful of stories, not one per variation.
2. Make every acceptance criterion pass by black-box execution: seed known state, drive the app, assert the visible result. For UI that is user-visible behaviour; a criterion is ready when the tester can run it without seeing inside the code. Fold enabling work such as layout scaffolding into the feature story that proves it. No story may be pure scaffolding; the first story must itself prove drivable, user-visible behaviour, not merely that controls exist.
3. Add only real, non-circular prerequisites: a story is independently implementable once its blockers pass. Blocking is not sequencing: leave blockedBy empty unless a story genuinely cannot be built until another has shipped, and prefer a set of independent stories over one chain. At least one story must always be unblocked.
4. Use the required fields exactly: id (positive, unique), title, description, acceptanceCriteria, blockedBy, status "todo". Do not supply review or test scores; the reviewer and tester set those later.

Write only to ${storiesPath} with write_stories. Submit the full list and fix validation errors.

## Request
${userRequest}`,
    });
  }
}
