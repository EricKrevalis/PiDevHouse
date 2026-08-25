import { expect, test } from "bun:test";
import { DeveloperAgent } from "../../src/modules/agents/developer/developer.agent";

const developerPrompt = await Bun.file(
  new URL("../../src/modules/agents/developer/developerPrompt.md", import.meta.url),
).text();

test("developer implements and tests without browser validation", () => {
  expect(developerPrompt).toContain("Put tests under `test/`");
  expect(developerPrompt).toContain("Do not perform browser validation");
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
  expect(agent.userPrompts[0]).toContain("Implement and unit-test");
  expect(agent.systemPrompt).toContain("unit tests only");
});
