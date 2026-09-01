import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";

vi.mock("../registry.ts", () => ({
  STORIES_PATH: "stories.json",
  AGENTS_PATH: "AGENTS.md",
  TOOLS: {
    read: "read",
    write: "write",
    edit: "edit",
    grep: "grep",
    find: "find",
    ls: "ls",
    bash: "bash",
    writeStories: "write_stories",
    updateStoryFields: "update_story_fields",
  },
}));

import { scopeToolCalls } from "../scope.ts";

type Hook = (
  ctx: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;

const context = (name: string, path: string): BeforeToolCallContext =>
  ({ toolCall: { name }, args: { path } }) as unknown as BeforeToolCallContext;

function scoped(
  roots: string | string[],
  writeAccess?: "all" | "notes",
): {
  beforeToolCall: Hook | undefined;
} {
  const agent: { beforeToolCall: Hook | undefined } = {
    beforeToolCall: undefined,
  };
  scopeToolCalls(
    agent,
    Array.isArray(roots) ? roots : [roots],
    25,
    writeAccess,
  );
  return agent;
}

it("blocks outside paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidev-"));
  const outside = await mkdtemp(join(tmpdir(), "pidev-"));
  const hook = scoped(root).beforeToolCall!;

  assert.equal(
    (await hook(context("write", join(outside, "x"))))?.block,
    true,
  );
});

it("allows paths inside any configured root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidev-"));
  const second = await mkdtemp(join(tmpdir(), "pidev-"));
  const hook = scoped([root, second]).beforeToolCall!;

  assert.equal(await hook(context("write", "src/index.ts")), undefined);
  assert.equal(
    (await hook(context("write", join(second, "story-1.png"))))?.block,
    undefined,
  );
  assert.equal(
    (await hook(context("write", join(root, "..", "escape.ts"))))?.block,
    true,
  );
});

it("blocks symlinks escaping the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidev-"));
  const outside = await mkdtemp(join(tmpdir(), "pidev-"));
  await symlink(outside, join(root, "link"));

  const result = await scoped(root).beforeToolCall!(context("write", "link/x"));
  assert.equal(result?.block, true);
});

it("allows normal in-root paths and protects stories.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidev-"));
  const hook = scoped(root).beforeToolCall!;

  assert.equal(await hook(context("write", "src/index.ts")), undefined);
  assert.equal(
    (await hook(context("write", "stories.json")))?.block,
    true,
  );
});

it("blocks tool calls beyond the configured limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidev-"));
  const agent: { beforeToolCall: Hook | undefined } = {
    beforeToolCall: undefined,
  };
  scopeToolCalls(agent, [root], 2);
  const hook = agent.beforeToolCall!;

  assert.equal(await hook(context("read", "src/a.ts")), undefined);
  assert.equal(await hook(context("read", "src/b.ts")), undefined);
  assert.equal((await hook(context("read", "src/c.ts")))?.block, true);
});

it("never blocks the verdict write on the budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidev-"));
  const agent: { beforeToolCall: Hook | undefined } = {
    beforeToolCall: undefined,
  };
  scopeToolCalls(agent, [root], 1);
  const hook = agent.beforeToolCall!;

  assert.equal(await hook(context("read", "src/a.ts")), undefined);
  assert.equal((await hook(context("read", "src/b.ts")))?.block, true);
  // the closing write is the one call the budget must let through: refusing it
  // burns the iteration silently and eventually blocks the story.
  assert.equal(
    (await hook(context("update_story_fields", "")))?.block,
    undefined,
  );
  assert.equal((await hook(context("write_stories", "")))?.block, undefined);
});

it("does not spend the budget on calls it refuses", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidev-"));
  const outside = await mkdtemp(join(tmpdir(), "pidev-"));
  const agent: { beforeToolCall: Hook | undefined } = {
    beforeToolCall: undefined,
  };
  const budget = scopeToolCalls(agent, [root], 2);
  const hook = agent.beforeToolCall!;

  assert.equal((await hook(context("read", join(outside, "a"))))?.block, true);
  assert.equal((await hook(context("read", join(outside, "b"))))?.block, true);
  // two refusals earlier, so both allowed calls are still available.
  assert.equal(await hook(context("read", "src/a.ts")), undefined);
  assert.equal(await hook(context("read", "src/b.ts")), undefined);
  assert.equal((await hook(context("read", "src/c.ts")))?.block, true);
  assert.deepEqual(budget, { executed: 2, rejected: 3 });
});

it("notes-only write access allows AGENTS.md and blocks other writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidev-"));
  const hook = scoped(root, "notes").beforeToolCall!;

  assert.equal(await hook(context("edit", "AGENTS.md")), undefined);
  assert.equal((await hook(context("write", "src/index.html")))?.block, true);
  assert.equal((await hook(context("write", "stories.json")))?.block, true);
});

it("stops an agent that only reissues refused calls", () => {
  // rejections no longer spend the executed budget, which removed the accidental
  // bound on a refusal loop: every refusal still costs a model round trip.
  const agent: { beforeToolCall: Hook | undefined } = {
    beforeToolCall: undefined,
  };
  const budget = scopeToolCalls(agent, ["/nonexistent-root"], 2);
  const hook = agent.beforeToolCall!;

  return (async () => {
    const outside = "/etc/passwd";
    let lastReason = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await hook(context("read", outside));
      assert.equal(result?.block, true);
      lastReason = result?.reason ?? "";
    }
    // 2 * maxToolCalls refusals, then the guard stops asking the model to retry
    assert.match(lastReason, /Too many refused tool calls/);
    assert.equal(budget.executed, 0);
  })();
});

it("keeps the verdict write available even after the refusal cap", async () => {
  const agent: { beforeToolCall: Hook | undefined } = {
    beforeToolCall: undefined,
  };
  scopeToolCalls(agent, ["/nonexistent-root"], 1);
  const hook = agent.beforeToolCall!;

  for (let attempt = 0; attempt < 6; attempt++) {
    await hook(context("read", "/etc/passwd"));
  }
  // the whole point of the exemption: a refused turn can still record a result
  assert.equal(
    (await hook(context("update_story_fields", "")))?.block,
    undefined,
  );
});
