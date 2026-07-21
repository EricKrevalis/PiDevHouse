import { createStoryAgents, getStoryIds } from "../src/agents.ts";

Deno.test("creates a role chain for one explicit story", () => {
  const agents = createStoryAgents(7, "stories.json");

  if (
    agents.map((agent) => agent.name).join(",") !== "developer,reviewer,tester"
  ) {
    throw new Error("Story role chain is incomplete");
  }
  if (agents.some((agent) => !agent.userPrompt.includes("story 7"))) {
    throw new Error("A role was not assigned the explicit story");
  }
});

Deno.test("reads unique story IDs in Product Owner order", () => {
  const ids = getStoryIds('{"stories":[{"id":2},{"id":5}]}');
  if (ids.join(",") !== "2,5") throw new Error("Story order changed");
});

Deno.test("rejects duplicate story IDs", () => {
  try {
    getStoryIds('{"stories":[{"id":1},{"id":1}]}');
    throw new Error("Duplicate story IDs were accepted");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate")) {
      throw error;
    }
  }
});
