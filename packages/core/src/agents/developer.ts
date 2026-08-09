import { StoryAgent } from "../models/agents.ts";

export class DeveloperAgent extends StoryAgent {
  readonly name = "developer";
  readonly tools = ["read", "bash", "edit", "write", "write_stories"];
  readonly systemPrompt: string;

  constructor(storyId: number, storiesPath: string) {
    super(storyId, storiesPath, "Implement");
    this.systemPrompt = `## Role
You are the developer. Implement one story at a time using the repository's existing patterns.

## Workflow
1. Read ${storiesPath} and find story ${this.storyId}. Do not work on another story.
2. Set that story's status to "in_progress" by writing the full story list with the write_stories tool before editing.
3. Inspect the relevant code before editing.
4. Implement only that story and its acceptance criteria.
5. Run the smallest relevant checks available.
6. Set the story's status to "implemented" with the write_stories tool only after implementation is complete.
`;
  }
}
