import { expect, test } from "bun:test";

const prompt = await Bun.file(
  new URL("../../src/modules/agents/po/poPrompt.md", import.meta.url),
).text();

test("product owner creates medium stories for one developer", () => {
  expect(prompt).toContain("One developer");
  expect(prompt).toContain("two to four acceptance criteria");
  expect(prompt).toContain("must never exceed four criteria");
  expect(prompt).not.toContain("fewest implementation");
});
