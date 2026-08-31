import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentContext } from "../../model/agents/agent.model.ts";
import { Config } from "../../model/config.model.ts";
import type { ModelProvider } from "../../model/providers/modelProvider.model.ts";
import type { Story } from "../../model/story.model.ts";
import type { Workspace } from "../../model/workspace.model.ts";
import { StoryStore } from "../../tools/story/stories.ts";
import { ReviewerAgent } from "../reviewer.agent.ts";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: { create: () => ({}), inMemory: () => ({}) },
}));

const workspace: Workspace = {
  logDir: "/output/run/log",
  workspaceDir: "/output/run/src",
  testDir: "/output/run/test",
};

function story(reviewResult: Story["reviewResult"]): Story {
  return {
    id: 1,
    title: "Story 1",
    description: "desc",
    acceptanceCriteria: ["criterion"],
    blockedBy: [],
    status: "implemented",
    reviewResult,
    testResult: { score: 0, note: "" },
  };
}

async function reviewerFor(
  initial: Story["reviewResult"],
): Promise<{ agent: ReviewerAgent; storyStore: StoryStore; prompts: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "reviewer-test-"));
  const storyStore = new StoryStore(join(dir, "stories.json"));
  await storyStore.write([story(initial)]);
  const prompts: string[] = [];
  const agent = new ReviewerAgent(
    1,
    storyStore.path,
    workspace,
    {} as ModelProvider,
    Config.from({ request: "req", minScore: 75 }),
    "run-1",
    { storyStore } as unknown as AgentContext,
  );
  return { agent, storyStore, prompts };
}

// the nudge exists for the turn that ends without a verdict, so it must fire on
// an unchanged reviewResult and stay silent once the reviewer has written one.
it("nudges the reviewer when the turn wrote no reviewResult", async () => {
  const { agent, prompts } = await reviewerFor({ score: 0, note: "" });
  const session = {
    prompt: async (text: string) => {
      prompts.push(text);
    },
  } as unknown as AgentSession;

  await (
    agent as unknown as {
      run: (id?: number, iteration?: number) => Promise<void>;
      afterPrompt: (session: AgentSession) => Promise<void>;
    }
  ).afterPrompt.call(
    Object.assign(agent, { reviewResultBefore: { score: 0, note: "" } }),
    session,
  );

  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /without writing reviewResult for story 1/);
  assert.match(prompts[0] ?? "", /below 75/);
});

it("stays silent when the reviewer already wrote a reviewResult", async () => {
  const { agent, storyStore, prompts } = await reviewerFor({
    score: 0,
    note: "",
  });
  await storyStore.write([story({ score: 82, note: "No findings" })]);
  const session = {
    prompt: async (text: string) => {
      prompts.push(text);
    },
  } as unknown as AgentSession;

  await (
    agent as unknown as { afterPrompt: (session: AgentSession) => Promise<void> }
  ).afterPrompt.call(
    Object.assign(agent, { reviewResultBefore: { score: 0, note: "" } }),
    session,
  );

  assert.deepEqual(prompts, []);
});
