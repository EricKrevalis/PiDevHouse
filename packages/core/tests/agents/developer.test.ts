import { expect, test } from "bun:test";
import { DeveloperAgent } from "../../src/modules/agents/developer/developer.agent";

const developerPrompt = await Bun.file(
  new URL("../../src/modules/agents/developer/developerPrompt.md", import.meta.url),
).text();

test("developer implements and tests without browser validation", () => {
  expect(developerPrompt).toContain("unit tests under `test/`");
  expect(developerPrompt).toContain("pure unit tests");
  expect(developerPrompt).toContain("Keep tests independent of DOM");
  expect(developerPrompt).toContain("Leave browser validation to the tester");
  const agent = new DeveloperAgent(
    1,
    "/workspace" as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  expect(agent.userPrompts).toHaveLength(1);
  expect(agent.userPrompts[0]).toContain("Implement story 1");
  expect(agent.systemPrompt).toContain("pure unit tests");
});
