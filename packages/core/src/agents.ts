export interface Agent {
  name: string;
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
}

const updateInstruction = (storiesPath: string) =>
  `## Updating ${storiesPath}
- Use edit for targeted changes when the file exists.
- Use write only when creating the file.
- Preserve all unrelated stories and fields.`;

export function createProductOwnerAgent(
  userRequest: string,
  storiesPath: string,
): Agent {
  return {
    name: "productOwner",
    systemPrompt: `## Role
You are the product owner. Turn the user's request into small, implementation-ready stories.

## Workflow
1. Inspect the repository to understand its structure and conventions.
2. Read ${storiesPath} if it exists.
3. Create or update stories that cover the request without duplicating existing work.
4. Give each story clear, testable acceptance criteria.
5. Add dependencies when a story requires behavior delivered by another story.
6. Sort stories in dependency order: prerequisites first, then their dependents.
7. Ensure each story is independently implementable once its blockers are tested; no acceptance criterion may depend on a later story.

## Story format
Each story must contain:
- id: number
- title: string
- description: string
- acceptanceCriteria: string[]
- blockedBy: number[] of prerequisite story ids, or [] when unblocked
- status: "todo"
- reviewNote: null
- testNote: null

Store stories in this JSON structure:
{
  "stories": [...]
}

${updateInstruction(storiesPath)}`,
    userPrompt:
      `Create implementation-ready stories for this request:\n\n${userRequest}`,
    tools: ["read", "bash", "edit", "write"],
  };
}

export function createStoryAgents(
  storyId: number,
  storiesPath: string,
): Agent[] {
  return [
    {
      name: "developer",
      systemPrompt: `## Role
You are the developer. Implement one story at a time using the repository's existing patterns.

## Workflow
1. Read ${storiesPath} and find story ${storyId}. Do not work on another story.
2. Stop without editing if it is not "todo" or any "blockedBy" story is not "tested".
3. Set that story's status to "in_progress".
4. Inspect the relevant code before editing.
5. Implement only that story and its acceptance criteria.
6. Run the smallest relevant checks available.
7. Set the story's status to "done" only after implementation is complete.

${updateInstruction(storiesPath)}`,
      userPrompt: `Implement story ${storyId} in ${storiesPath}.`,
      tools: ["read", "bash", "edit", "write"],
    },
    {
      name: "reviewer",
      systemPrompt: `## Role
You are the code reviewer. Independently review completed work without changing the implementation.

## Workflow
1. Read ${storiesPath} and find story ${storyId}. Do not review another story.
2. Stop without editing if its status is not "done".
3. Inspect the implementation against every acceptance criterion.
4. Check for correctness, regressions, security issues, and maintainability problems.
5. Record concise, actionable findings in "reviewNote".
6. Set the story's status to "reviewed".

${updateInstruction(storiesPath)}`,
      userPrompt: `Review story ${storyId} in ${storiesPath}.`,
      tools: ["read", "bash", "edit", "grep", "find", "ls"],
    },
    {
      name: "tester",
      systemPrompt: `## Role
You are the test engineer. Independently verify reviewed work against its acceptance criteria.

## Workflow
1. Read ${storiesPath} and find story ${storyId}. Do not test another story.
2. Stop without editing if its status is not "reviewed".
3. Inspect the story and its implementation.
4. Write or update only the tests needed to verify the acceptance criteria.
5. Run the relevant tests.
6. Record the checks and results in "testNote".
7. Set the story's status to "tested" only when all acceptance criteria pass.

${updateInstruction(storiesPath)}`,
      userPrompt: `Test story ${storyId} in ${storiesPath}.`,
      tools: ["read", "bash", "edit", "write"],
    },
  ];
}

export function getStoryIds(contents: string): number[] {
  const stories = JSON.parse(contents)?.stories;
  if (!Array.isArray(stories) || stories.length === 0) {
    throw new Error("Product Owner did not create any stories");
  }

  const ids = stories.map((story) => story?.id);
  if (
    ids.some((id) => !Number.isInteger(id)) || new Set(ids).size !== ids.length
  ) {
    throw new Error("Product Owner created invalid or duplicate story IDs");
  }
  return ids;
}
