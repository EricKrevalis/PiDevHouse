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
  TOOLS: {
    read: "read",
    write: "write",
    edit: "edit",
    grep: "grep",
    find: "find",
    ls: "ls",
  },
}));

import { scopeToolCalls } from "../scope.ts";

type Hook = (
  ctx: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;

const context = (name: string, path: string): BeforeToolCallContext =>
  ({ toolCall: { name }, args: { path } }) as unknown as BeforeToolCallContext;

function scoped(roots: string | string[]): {
  beforeToolCall: Hook | undefined;
} {
  const agent: { beforeToolCall: Hook | undefined } = {
    beforeToolCall: undefined,
  };
  scopeToolCalls(agent, Array.isArray(roots) ? roots : [roots]);
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
