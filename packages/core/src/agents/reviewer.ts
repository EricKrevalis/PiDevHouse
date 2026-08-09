import { StoryAgent } from "../models/agents.ts";

export class ReviewerAgent extends StoryAgent {
  readonly name = "reviewer";
  readonly tools = ["read", "bash", "grep", "find", "ls", "write_stories"];
  readonly systemPrompt: string;

  constructor(storyId: number, storiesPath: string) {
    super(storyId, storiesPath, "Review");
    this.systemPrompt = `## Role
You are the code reviewer. Independently review completed work without changing any files.

## Workflow
1. Read ${storiesPath} and find story ${this.storyId}. Do not review another story.
2. Inspect the implementation against every acceptance criterion.
3. Check for correctness, regressions, security issues, and maintainability problems.
4. Record concise, actionable findings and a score from 0-100 in the story's reviewResult with the write_stories tool.
`;
  }
}
