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

  test("leaves one finalization turn after the configured limit", async () => {
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
    const finalization = await agent.beforeToolCall?.(context);
    expect(finalization?.block).toBe(true);
    expect(finalization?.terminate).toBeUndefined();
    expect(await agent.beforeToolCall?.(context)).toMatchObject({
      block: true,
      terminate: true,
    });
  });

  test("warns at 70% and 85% of the budget", async () => {
    const { roots } = await createWorkspace();
    const warnings: unknown[] = [];
    const agent: Pick<Agent, "beforeToolCall" | "steer"> = {
      steer: (message) => warnings.push(message),
    };
    scopeToolCalls(agent, roots, 10);
    const context = {
      toolCall: { name: "get_story" },
      args: { id: 1 },
    } as never;

    for (let i = 0; i < 7; i++) {
      await agent.beforeToolCall?.(context);
    }
    expect(warnings).toEqual([
      {
        role: "user",
        content: "Warning: 70% of the tool call budget used (7/10).",
        timestamp: expect.any(Number),
      },
    ]);
    await agent.beforeToolCall?.(context);
    await agent.beforeToolCall?.(context);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toMatchObject({
      content: "Warning: 85% of the tool call budget used (9/10).",
    });
    await agent.beforeToolCall?.(context);
    expect(warnings).toHaveLength(2);
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
    const finalization = await call("get_story");
    expect(finalization?.block).toBe(true);
    expect(finalization?.terminate).toBeUndefined();
    expect(await call("update_story_status")).toBeUndefined();
  });

  test("does not count screenshot evidence toward the tool limit", async () => {
    const { roots } = await createWorkspace();
    const agent: Pick<Agent, "beforeToolCall" | "steer"> = {
      steer: () => {},
    };
    scopeToolCalls(agent, roots, 1);
    const call = (action: string) =>
      agent.beforeToolCall?.({
        toolCall: { name: "browser" },
        args: { action },
      } as never);

    expect(await call("screenshot")).toBeUndefined();
    expect(await call("snapshot")).toBeUndefined();
    expect(await call("click")).toMatchObject({ block: true });
  });
});
