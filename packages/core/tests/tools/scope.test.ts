import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@earendil-works/pi-agent-core";
import { scopeToolCalls } from "../../src/modules/tools/scope";

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.PIDEV_SANDBOX_SECRET;
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "pidev-sandbox-"));
  cleanup.push(root);
  const src = join(root, "src");
  const testRoot = join(root, "test");
  await Promise.all([mkdir(src), mkdir(testRoot)]);
  return { root, roots: [src, testRoot] };
}

async function checkPath(tool: string, path?: string) {
  const { roots } = await createWorkspace();
  const agent: Pick<Agent, "beforeToolCall" | "steer"> = { steer: () => {} };
  scopeToolCalls(agent, roots);
  return agent.beforeToolCall?.({
    toolCall: { name: tool },
    args: path === undefined ? {} : { path },
  } as never);
}

describe("scoped tools", () => {
  test("allows src/test paths and blocks sibling, absolute, and symlink escapes", async () => {
    expect(await checkPath("read", "src/file.ts")).toBeUndefined();
    expect((await checkPath("grep", "log"))?.block).toBe(true);
    expect((await checkPath("write", "/etc/passwd"))?.block).toBe(true);

    const { root, roots } = await createWorkspace();
    await symlink(homedir(), join(root, "src", "home"));
    const agent: Pick<Agent, "beforeToolCall" | "steer"> = {
      steer: () => {},
    };
    scopeToolCalls(agent, roots);
    const escaped = await agent.beforeToolCall?.({
      toolCall: { name: "edit" },
      args: { path: "src/home/.profile" },
    } as never);
    expect(escaped?.block).toBe(true);
  });

  test("blocks grep without a path", async () => {
    expect((await checkPath("grep"))?.block).toBe(true);
  });

  test("blocks tool calls after the configured limit", async () => {
    const { roots } = await createWorkspace();
    const agent: Pick<Agent, "beforeToolCall" | "steer"> = {
      steer: () => {},
    };
    scopeToolCalls(agent, roots, 1);
    const context = {
      toolCall: { name: "get_story" },
      args: { id: 1 },
    } as never;

    expect(await agent.beforeToolCall?.(context)).toBeUndefined();
    expect(await agent.beforeToolCall?.(context)).toMatchObject({
      block: true,
      terminate: true,
    });
  });

  test("warns before the final allowed tool call", async () => {
    const { roots } = await createWorkspace();
    const warnings: unknown[] = [];
    const agent: Pick<Agent, "beforeToolCall" | "steer"> = {
      steer: (message) => warnings.push(message),
    };
    scopeToolCalls(agent, roots, 3);
    const context = {
      toolCall: { name: "get_story" },
      args: { id: 1 },
    } as never;

    expect(await agent.beforeToolCall?.(context)).toBeUndefined();
    expect(warnings).toHaveLength(0);
    expect(await agent.beforeToolCall?.(context)).toBeUndefined();
    expect(warnings).toEqual([
      {
        role: "user",
        content: "Warning: one tool call remaining (limit 3).",
        timestamp: expect.any(Number),
      },
    ]);
    expect(await agent.beforeToolCall?.(context)).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  test("does not count story writes toward the tool limit", async () => {
    const { roots } = await createWorkspace();
    const agent: Pick<Agent, "beforeToolCall" | "steer"> = {
      steer: () => {},
    };
    scopeToolCalls(agent, roots, 1);
    const call = (name: string) =>
      agent.beforeToolCall?.({ toolCall: { name }, args: {} } as never);

    expect(await call("update_story_status")).toBeUndefined();
    expect(await call("update_validation_result")).toBeUndefined();
    expect(await call("create_stories")).toBeUndefined();
    expect(await call("get_story")).toBeUndefined();
    expect(await call("get_story")).toMatchObject({
      block: true,
      terminate: true,
    });
  });
});

