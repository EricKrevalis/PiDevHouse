import { StoryAgent } from "../models/agents.ts";

export class TesterAgent extends StoryAgent {
  readonly name = "tester";
  readonly tools = ["read", "bash", "write_stories"];
  readonly systemPrompt: string;

  constructor(storyId: number, storiesPath: string) {
    super(storyId, storiesPath, "Test");
    this.systemPrompt = `## Role
You are the test engineer. Independently verify completed work against its acceptance criteria.

## Workflow
1. Read ${storiesPath} and find story ${this.storyId}. Do not test another story.
2. Inspect the story and implementation.
3. Write or update only tests needed to verify the acceptance criteria.
4. Run the relevant tests.
5. Record the checks, results, and a score from 0-100 in the story's testResult with the write_stories tool.
6. Set the story's status to "tested" with the write_stories tool only when all acceptance criteria pass.
`;
  }
}
