import { expect, test } from "bun:test";
import { TesterAgent } from "../../src/modules/agents/tester/tester.agent";
import type { Config } from "../../src/modules/models/config.model";

const prompt = await Bun.file(
  new URL("../../src/modules/agents/tester/testerPrompt.md", import.meta.url),
).text();

test("does not let browser cleanup kill its own shell", () => {
  expect(prompt).not.toContain("pkill -f");
  expect(prompt).not.toContain("provided agent-browser skill");
});

test("uses bundled browser instructions without remote skill setup", () => {
  const config: Config = {
    outputDir: "" as never,
    maxIteration: 1,
    minScore: 60,
    maxToolCalls: 1,
    runTimeoutSeconds: 1,
  };
  const tester = new TesterAgent(
    1,
    "/workspace" as never,
    {} as never,
    config,
    {} as never,
    {} as never,
    {} as never,
  );

  expect(tester.userPrompts[0]).not.toStartWith("/skill:");
  expect(tester.userPrompts[0]).toContain("browser `serve` once");
  expect(tester.userPrompts[0]).toContain("serve");
  expect(tester.userPrompts[0]).not.toContain("open_file");
  expect(tester.userPrompts[0]).toContain("criterion number");
  expect(tester.tools).not.toContain("edit");
  expect(tester.userPrompts[0]).toContain("black box");
});
