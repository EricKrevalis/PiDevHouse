import { expect, test } from "bun:test";
import { ReviewerAgent } from "../../src/modules/agents/reviewer/reviewer.agent";
import type { Config } from "../../src/modules/models/config.model";

const config: Config = {
  outputDir: "" as never,
  maxIteration: 1,
  minScore: 60,
  maxToolCalls: 1,
  runTimeoutSeconds: 1,
};

test("reviewer is read-only apart from validation status tools", () => {
  const reviewer = new ReviewerAgent(
    1,
    "/workspace" as never,
    {} as never,
    config,
    {} as never,
    {} as never,
    {} as never,
  );

  expect(reviewer.tools).toEqual(["read", "bash", "grep"]);
  expect(reviewer.systemPrompt).toContain("only writes");
  expect(reviewer.userPrompts[0]).toContain("implementation files and screenshots unchanged");
});
